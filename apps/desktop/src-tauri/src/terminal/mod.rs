use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::Serialize;
use std::{
    collections::HashMap,
    ffi::CString,
    fs::File,
    io::{Read, Write},
    os::fd::{AsRawFd, FromRawFd},
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
};
use tauri::Emitter;

const MAX_TERMINAL_INPUT_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalLaunch {
    pub task_id: String,
    pub pid: u32,
    pub shell: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalOutput {
    task_id: String,
    data_base64: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalExit {
    task_id: String,
    code: Option<i32>,
    signal: Option<i32>,
}

#[derive(Debug)]
struct PtyProcess {
    pid: libc::pid_t,
    writer: Mutex<File>,
    alive: Arc<AtomicBool>,
}

impl PtyProcess {
    fn spawn(
        cwd: &Path,
        shell: &str,
        columns: u16,
        rows: u16,
        on_output: Arc<dyn Fn(Vec<u8>) + Send + Sync>,
        on_exit: Arc<dyn Fn(Option<i32>, Option<i32>) + Send + Sync>,
    ) -> Result<Arc<Self>, String> {
        let cwd = cwd
            .canonicalize()
            .map_err(|error| format!("Cannot resolve terminal cwd: {error}"))?;
        if !cwd.is_dir() {
            return Err("Terminal cwd must be a directory".into());
        }
        let cwd_c = CString::new(cwd.as_os_str().as_encoded_bytes())
            .map_err(|_| "Terminal cwd contains a NUL byte".to_string())?;
        let shell_c = CString::new(shell)
            .map_err(|_| "Terminal shell path contains a NUL byte".to_string())?;
        let argv0 = CString::new(
            Path::new(shell)
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("zsh"),
        )
        .map_err(|_| "Terminal shell name contains a NUL byte".to_string())?;
        let login = CString::new("-l").expect("static terminal argument");
        let term_name = CString::new("TERM").expect("static terminal environment key");
        let term_value = CString::new("xterm-256color").expect("static terminal environment value");
        let lang_name = CString::new("LANG").expect("static terminal environment key");
        let lang_value = CString::new("en_US.UTF-8").expect("static terminal environment value");
        let mut master = -1;
        let mut window = libc::winsize {
            ws_row: rows.clamp(4, 500),
            ws_col: columns.clamp(20, 500),
            ws_xpixel: 0,
            ws_ypixel: 0,
        };

        // SAFETY: allocations and C strings are prepared before forkpty. The
        // child calls only async-signal-safe libc functions before execv.
        let pid = unsafe {
            libc::forkpty(
                &mut master,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                &mut window,
            )
        };
        if pid < 0 {
            return Err(format!(
                "Cannot start terminal PTY: {}",
                std::io::Error::last_os_error()
            ));
        }
        if pid == 0 {
            let argv = [argv0.as_ptr(), login.as_ptr(), std::ptr::null()];
            unsafe {
                if libc::chdir(cwd_c.as_ptr()) != 0 {
                    libc::_exit(126);
                }
                libc::setenv(term_name.as_ptr(), term_value.as_ptr(), 1);
                libc::setenv(lang_name.as_ptr(), lang_value.as_ptr(), 0);
                libc::execv(shell_c.as_ptr(), argv.as_ptr());
                libc::_exit(127);
            }
        }

        // SAFETY: forkpty returns ownership of the master descriptor to parent.
        let mut reader = unsafe { File::from_raw_fd(master) };
        let writer = reader
            .try_clone()
            .map_err(|error| format!("Cannot clone terminal PTY: {error}"))?;
        let alive = Arc::new(AtomicBool::new(true));
        let process = Arc::new(Self {
            pid,
            writer: Mutex::new(writer),
            alive: alive.clone(),
        });
        let process_for_failure = process.clone();
        if let Err(error) = thread::Builder::new()
            .name(format!("pi-terminal-{pid}"))
            .spawn(move || {
                let mut buffer = [0_u8; 16 * 1024];
                loop {
                    match reader.read(&mut buffer) {
                        Ok(0) => break,
                        Ok(read) => on_output(buffer[..read].to_vec()),
                        Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                        Err(_) => break,
                    }
                }
                let mut status = 0;
                let waited = unsafe { libc::waitpid(pid, &mut status, 0) };
                alive.store(false, Ordering::Release);
                if waited < 0 {
                    on_exit(None, None);
                } else if libc::WIFEXITED(status) {
                    on_exit(Some(libc::WEXITSTATUS(status)), None);
                } else if libc::WIFSIGNALED(status) {
                    on_exit(None, Some(libc::WTERMSIG(status)));
                } else {
                    on_exit(None, None);
                }
            })
        {
            process_for_failure.terminate();
            return Err(format!("Cannot start terminal reader: {error}"));
        }
        Ok(process)
    }

    fn write(&self, data: &[u8]) -> Result<(), String> {
        if data.is_empty() {
            return Ok(());
        }
        if data.len() > MAX_TERMINAL_INPUT_BYTES {
            return Err("Terminal input exceeds the 64 KiB limit".into());
        }
        if !self.alive.load(Ordering::Acquire) {
            return Err("Terminal process has exited".into());
        }
        self.writer
            .lock()
            .map_err(|_| "Terminal writer lock is poisoned".to_string())?
            .write_all(data)
            .map_err(|error| format!("Write terminal input: {error}"))
    }

    fn resize(&self, columns: u16, rows: u16) -> Result<(), String> {
        let window = libc::winsize {
            ws_row: rows.clamp(4, 500),
            ws_col: columns.clamp(20, 500),
            ws_xpixel: 0,
            ws_ypixel: 0,
        };
        let descriptor = self
            .writer
            .lock()
            .map_err(|_| "Terminal writer lock is poisoned".to_string())?
            .as_raw_fd();
        let result = unsafe { libc::ioctl(descriptor, libc::TIOCSWINSZ, &window) };
        if result == 0 {
            Ok(())
        } else {
            Err(format!(
                "Resize terminal PTY: {}",
                std::io::Error::last_os_error()
            ))
        }
    }

    fn terminate(&self) {
        if self.alive.swap(false, Ordering::AcqRel) {
            unsafe {
                libc::kill(self.pid, libc::SIGHUP);
            }
        }
    }
}

#[derive(Debug, Default)]
pub struct TerminalManager {
    sessions: Mutex<HashMap<String, Arc<PtyProcess>>>,
}

impl TerminalManager {
    pub fn start(
        &self,
        app: &tauri::AppHandle,
        task_id: &str,
        cwd: &Path,
    ) -> Result<TerminalLaunch, String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| "Terminal manager lock is poisoned".to_string())?;
        if let Some(existing) = sessions.get(task_id) {
            if existing.alive.load(Ordering::Acquire) {
                return Ok(TerminalLaunch {
                    task_id: task_id.to_string(),
                    pid: existing.pid as u32,
                    shell: "/bin/zsh".into(),
                });
            }
            sessions.remove(task_id);
        }
        let output_app = app.clone();
        let output_task_id = task_id.to_string();
        let exit_app = app.clone();
        let exit_task_id = task_id.to_string();
        let process = PtyProcess::spawn(
            cwd,
            "/bin/zsh",
            100,
            20,
            Arc::new(move |data| {
                let _ = output_app.emit(
                    "terminal-output",
                    TerminalOutput {
                        task_id: output_task_id.clone(),
                        data_base64: BASE64.encode(data),
                    },
                );
            }),
            Arc::new(move |code, signal| {
                let _ = exit_app.emit(
                    "terminal-exit",
                    TerminalExit {
                        task_id: exit_task_id.clone(),
                        code,
                        signal,
                    },
                );
            }),
        )?;
        let launch = TerminalLaunch {
            task_id: task_id.to_string(),
            pid: process.pid as u32,
            shell: "/bin/zsh".into(),
        };
        sessions.insert(task_id.to_string(), process);
        Ok(launch)
    }

    pub fn write(&self, task_id: &str, data: &str) -> Result<(), String> {
        self.session(task_id)?.write(data.as_bytes())
    }

    pub fn resize(&self, task_id: &str, columns: u16, rows: u16) -> Result<(), String> {
        self.session(task_id)?.resize(columns, rows)
    }

    pub fn stop(&self, task_id: &str) -> Result<(), String> {
        let session = self
            .sessions
            .lock()
            .map_err(|_| "Terminal manager lock is poisoned".to_string())?
            .remove(task_id);
        if let Some(session) = session {
            session.terminate();
        }
        Ok(())
    }

    pub fn stop_all(&self) -> Result<(), String> {
        let sessions: Vec<Arc<PtyProcess>> = self
            .sessions
            .lock()
            .map_err(|_| "Terminal manager lock is poisoned".to_string())?
            .drain()
            .map(|(_, session)| session)
            .collect();
        for session in sessions {
            session.terminate();
        }
        Ok(())
    }

    fn session(&self, task_id: &str) -> Result<Arc<PtyProcess>, String> {
        self.sessions
            .lock()
            .map_err(|_| "Terminal manager lock is poisoned".to_string())?
            .get(task_id)
            .filter(|session| session.alive.load(Ordering::Acquire))
            .cloned()
            .ok_or_else(|| format!("No active user terminal for task: {task_id}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        time::{Duration, Instant},
    };
    use uuid::Uuid;

    #[test]
    fn launches_a_real_pty_and_accepts_interactive_input() {
        let cwd = std::env::temp_dir().join(format!("pi-pty-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&cwd).unwrap();
        let output = Arc::new(Mutex::new(Vec::<u8>::new()));
        let captured = output.clone();
        let process = PtyProcess::spawn(
            &cwd,
            "/bin/zsh",
            80,
            20,
            Arc::new(move |data| captured.lock().unwrap().extend(data)),
            Arc::new(|_, _| {}),
        )
        .unwrap();
        process.write(b"printf '__PI_PTY_OK__\\n'\nexit\n").unwrap();
        let deadline = Instant::now() + Duration::from_secs(4);
        while process.alive.load(Ordering::Acquire) && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(20));
        }
        let rendered = String::from_utf8_lossy(&output.lock().unwrap()).into_owned();
        assert!(rendered.contains("__PI_PTY_OK__"));
        process.terminate();
        fs::remove_dir_all(cwd).unwrap();
    }
}
