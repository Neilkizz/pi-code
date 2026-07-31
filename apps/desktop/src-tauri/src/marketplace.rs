use crate::storage::app_paths::AppPaths;
use reqwest::blocking::Client;
use semver::Version;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    os::unix::fs::OpenOptionsExt,
    path::{Path, PathBuf},
    process::Command,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::AppHandle;
use url::Url;
use uuid::Uuid;

#[cfg(not(debug_assertions))]
use tauri::Manager;

const CATALOG_URL: &str = "https://pi.dev/packages";
const REGISTRY_URL: &str = "https://registry.npmjs.org";
const MAX_CATALOG_BYTES: u64 = 4 * 1024 * 1024;
const MAX_REGISTRY_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketplaceQuery {
    pub search: Option<String>,
    pub page: Option<u32>,
    pub sort: Option<MarketplaceSort>,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MarketplaceSort {
    Downloads,
    Recent,
    Name,
}

impl MarketplaceSort {
    fn as_str(self) -> &'static str {
        match self {
            Self::Downloads => "downloads",
            Self::Recent => "recent",
            Self::Name => "name",
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MarketplacePackage {
    pub name: String,
    pub description: String,
    pub version: String,
    pub author: String,
    pub types: Vec<String>,
    pub downloads: u64,
    pub published_at: u64,
    pub npm_url: String,
    pub repository_url: Option<String>,
    pub detail_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketplacePage {
    pub source: &'static str,
    pub packages: Vec<MarketplacePackage>,
    pub page: u32,
    pub total_pages: u32,
    pub fetched_at: u64,
}

#[derive(Debug)]
pub struct PreparedPackage {
    pub staging_root: PathBuf,
    pub package_root: PathBuf,
    pub package_name: String,
    pub version: String,
    pub dependency_count: usize,
}

pub fn fetch_catalog(query: MarketplaceQuery) -> Result<MarketplacePage, String> {
    let page = query.page.unwrap_or(1).clamp(1, 200);
    let search = query.search.unwrap_or_default();
    let search = search.trim();
    if search.chars().count() > 100 {
        return Err("Marketplace search is limited to 100 characters".into());
    }
    let sort = query.sort.unwrap_or(MarketplaceSort::Downloads);
    let mut url = Url::parse(CATALOG_URL).map_err(|error| error.to_string())?;
    {
        let mut pairs = url.query_pairs_mut();
        pairs.append_pair("type", "extension");
        pairs.append_pair("sort", sort.as_str());
        pairs.append_pair("page", &page.to_string());
        if !search.is_empty() {
            pairs.append_pair("name", search);
        }
    }
    let html = fetch_text(url, MAX_CATALOG_BYTES)?;
    let (packages, total_pages) = parse_catalog(&html);
    Ok(MarketplacePage {
        source: "pi.dev",
        packages,
        page,
        total_pages: total_pages.max(page),
        fetched_at: unix_millis()?,
    })
}

pub fn prepare_npm_package(
    app: &AppHandle,
    paths: &AppPaths,
    package_name: &str,
    requested_version: Option<&str>,
) -> Result<PreparedPackage, String> {
    validate_package_name(package_name)?;
    let metadata = fetch_registry_package(package_name)?;
    if metadata.name != package_name {
        return Err("Registry package identity does not match the requested package".into());
    }
    let version = requested_version
        .map(str::trim)
        .filter(|version| !version.is_empty())
        .unwrap_or(&metadata.version);
    validate_version(version)?;

    let staging_root = paths
        .packages
        .join(format!(".npm-staging-{}", Uuid::new_v4()));
    fs::create_dir_all(&staging_root).map_err(|error| error.to_string())?;
    let prepared = (|| {
        write_private_json(
            &staging_root.join("package.json"),
            &json!({
                "name": "pi-desktop-managed-package",
                "private": true
            }),
        )?;
        let install_spec = format!("{package_name}@{version}");
        run_npm_install(app, paths, &staging_root, &install_spec)?;
        let package_root = staging_root.join("node_modules").join(package_name);
        let manifest_path = package_root.join("package.json");
        let manifest_text = fs::read_to_string(&manifest_path)
            .map_err(|error| format!("Installed package manifest is unavailable: {error}"))?;
        let manifest: Value = serde_json::from_str(&manifest_text)
            .map_err(|error| format!("Installed package manifest is invalid: {error}"))?;
        let installed_name = manifest
            .get("name")
            .and_then(Value::as_str)
            .ok_or_else(|| "Installed package has no name".to_string())?;
        let installed_version = manifest
            .get("version")
            .and_then(Value::as_str)
            .ok_or_else(|| "Installed package has no version".to_string())?;
        if installed_name != package_name || installed_version != version {
            return Err(format!(
                "Installed package identity mismatch: expected {package_name}@{version}, received {installed_name}@{installed_version}"
            ));
        }
        let extension_entries = extension_entries(&manifest, &package_root, package_name)?;
        let dependency_count = manifest
            .get("dependencies")
            .and_then(Value::as_object)
            .map_or(0, serde_json::Map::len);
        let package_relative = Path::new("node_modules").join(package_name);
        let wrapper_entries = extension_entries
            .iter()
            .map(|entry| package_relative.join(entry).to_string_lossy().to_string())
            .collect::<Vec<_>>();
        write_private_json(
            &staging_root.join("package.json"),
            &json!({
                "name": "pi-desktop-managed-package",
                "private": true,
                "pi": { "extensions": wrapper_entries },
                "piDesktop": {
                    "package": package_name,
                    "version": installed_version,
                    "installScriptsExecuted": false
                }
            }),
        )?;
        Ok(PreparedPackage {
            staging_root: staging_root.clone(),
            package_root,
            package_name: package_name.to_string(),
            version: installed_version.to_string(),
            dependency_count,
        })
    })();

    if prepared.is_err() {
        let _ = fs::remove_dir_all(&staging_root);
    }
    prepared
}

pub fn latest_version(package_name: &str) -> Result<String, String> {
    validate_package_name(package_name)?;
    let metadata = fetch_registry_package(package_name)?;
    if metadata.name != package_name {
        return Err("Registry package identity does not match the requested package".into());
    }
    validate_version(&metadata.version)?;
    Ok(metadata.version)
}

#[derive(Debug, Deserialize)]
struct RegistryPackage {
    name: String,
    version: String,
}

fn fetch_registry_package(package_name: &str) -> Result<RegistryPackage, String> {
    let encoded = package_name.replace('@', "%40").replace('/', "%2F");
    let url = Url::parse(&format!("{REGISTRY_URL}/{encoded}/latest"))
        .map_err(|error| error.to_string())?;
    let text = fetch_text(url, MAX_REGISTRY_BYTES)?;
    serde_json::from_str(&text).map_err(|error| format!("Invalid npm registry response: {error}"))
}

pub(crate) fn run_npm_install(
    app: &AppHandle,
    paths: &AppPaths,
    install_root: &Path,
    install_spec: &str,
) -> Result<(), String> {
    let (program, leading_args) = npm_command(app)?;
    let cache = paths.packages.join("npm-cache");
    fs::create_dir_all(&cache).map_err(|error| error.to_string())?;
    let output = Command::new(&program)
        .args(&leading_args)
        .args([
            "install",
            install_spec,
            "--prefix",
            install_root
                .to_str()
                .ok_or_else(|| "Package staging path is not UTF-8".to_string())?,
            "--legacy-peer-deps",
            "--ignore-scripts",
            "--omit=dev",
            "--no-audit",
            "--no-fund",
            "--loglevel=error",
        ])
        .env("NPM_CONFIG_CACHE", &cache)
        .env("NPM_CONFIG_UPDATE_NOTIFIER", "false")
        .output()
        .map_err(|error| format!("Could not start the bundled npm client: {error}"))?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let message = stderr.chars().take(4_000).collect::<String>();
    Err(format!(
        "npm package installation failed with {}: {}",
        output.status,
        message.trim()
    ))
}

#[cfg(debug_assertions)]
fn npm_command(_app: &AppHandle) -> Result<(PathBuf, Vec<PathBuf>), String> {
    Ok((PathBuf::from("npm"), Vec::new()))
}

#[cfg(not(debug_assertions))]
fn npm_command(app: &AppHandle) -> Result<(PathBuf, Vec<PathBuf>), String> {
    let resources = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?;
    let node = resources.join("runtime/node/bin/node");
    let npm_cli = resources.join("runtime/node/lib/node_modules/npm/bin/npm-cli.js");
    if !node.is_file() || !npm_cli.is_file() {
        return Err(
            "The bundled npm runtime is unavailable. Rebuild the app with runtime staging.".into(),
        );
    }
    Ok((node, vec![npm_cli]))
}

fn extension_entries(
    manifest: &Value,
    package_root: &Path,
    package_name: &str,
) -> Result<Vec<PathBuf>, String> {
    let entries = manifest
        .pointer("/pi/extensions")
        .and_then(Value::as_array)
        .map(|entries| {
            entries
                .iter()
                .map(|entry| {
                    entry
                        .as_str()
                        .map(|entry| PathBuf::from(entry.trim_start_matches("./")))
                        .ok_or_else(|| {
                            format!("Package {package_name} has a non-string pi.extensions entry")
                        })
                })
                .collect::<Result<Vec<_>, _>>()
        })
        .transpose()?
        .unwrap_or_else(|| vec![PathBuf::from("extensions")]);
    if entries.is_empty() {
        return Err(format!(
            "Package {package_name} does not publish any Pi extensions"
        ));
    }
    for entry in &entries {
        if entry.is_absolute()
            || entry
                .components()
                .any(|component| matches!(component, std::path::Component::ParentDir))
        {
            return Err(format!(
                "Package {package_name} declares an unsafe extension path: {}",
                entry.display()
            ));
        }
        let has_glob = entry.to_string_lossy().contains(['*', '?', '[']);
        if !has_glob && !package_root.join(entry).exists() {
            return Err(format!(
                "Package {package_name} extension path does not exist: {}",
                entry.display()
            ));
        }
    }
    Ok(entries)
}

fn parse_catalog(html: &str) -> (Vec<MarketplacePackage>, u32) {
    let mut packages = Vec::new();
    for tail in html.split("<article").skip(1) {
        let Some(end) = tail.find("</article>") else {
            continue;
        };
        let block = &tail[..end];
        if attribute(block, "data-package-card").as_deref() != Some("true") {
            continue;
        }
        let Some(name) = attribute(block, "data-package-name") else {
            continue;
        };
        let types = attribute(block, "data-package-types")
            .unwrap_or_default()
            .split_whitespace()
            .map(str::to_string)
            .collect::<Vec<_>>();
        let version = extract_query_value(block, "package-version").unwrap_or_default();
        let detail_path = first_href_containing(block, "/packages/")
            .unwrap_or_else(|| format!("/packages/{name}"));
        let npm_url = first_href_containing(block, "https://www.npmjs.com/package/")
            .unwrap_or_else(|| format!("https://www.npmjs.com/package/{name}"));
        let repository_url = all_hrefs(block).into_iter().find(|href| {
            href.starts_with("https://github.com/")
                && !href.contains("earendil-works/pi/issues/new")
        });
        let author = element_text(
            element_html(block, "packages-meta")
                .as_deref()
                .unwrap_or_default(),
            "span",
        )
        .unwrap_or_default();
        packages.push(MarketplacePackage {
            name,
            description: element_text_by_class(block, "packages-desc").unwrap_or_default(),
            version,
            author,
            types,
            downloads: attribute(block, "data-package-downloads")
                .and_then(|value| value.parse().ok())
                .unwrap_or(0),
            published_at: attribute(block, "data-package-date")
                .and_then(|value| value.parse().ok())
                .unwrap_or(0),
            npm_url,
            repository_url,
            detail_url: format!(
                "https://pi.dev{}",
                detail_path.split('?').next().unwrap_or("")
            ),
        });
    }
    let total_pages = html
        .match_indices("page=")
        .filter_map(|(index, _)| {
            html[index + 5..]
                .chars()
                .take_while(char::is_ascii_digit)
                .collect::<String>()
                .parse::<u32>()
                .ok()
        })
        .max()
        .unwrap_or(1);
    (packages, total_pages)
}

fn attribute(block: &str, name: &str) -> Option<String> {
    let needle = format!("{name}=\"");
    let start = block.find(&needle)? + needle.len();
    let end = block[start..].find('"')? + start;
    Some(html_decode(&block[start..end]))
}

fn element_html(block: &str, class_name: &str) -> Option<String> {
    let class = format!("class=\"{class_name}\"");
    let tag_start = block.find(&class)?;
    let content_start = block[tag_start..].find('>')? + tag_start + 1;
    let content_end = block[content_start..].find("</div>")? + content_start;
    Some(block[content_start..content_end].to_string())
}

fn element_text_by_class(block: &str, class_name: &str) -> Option<String> {
    element_html_generic(block, class_name).map(|value| strip_tags(&value))
}

fn element_html_generic(block: &str, class_name: &str) -> Option<String> {
    let class = format!("class=\"{class_name}\"");
    let tag_start = block.find(&class)?;
    let open_start = block[..tag_start].rfind('<')?;
    let tag_name = block[open_start + 1..]
        .split_ascii_whitespace()
        .next()?
        .trim_matches('/');
    let content_start = block[tag_start..].find('>')? + tag_start + 1;
    let close = format!("</{tag_name}>");
    let content_end = block[content_start..].find(&close)? + content_start;
    Some(block[content_start..content_end].to_string())
}

fn element_text(block: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}");
    let start = block.find(&open)?;
    let content_start = block[start..].find('>')? + start + 1;
    let close = format!("</{tag}>");
    let content_end = block[content_start..].find(&close)? + content_start;
    Some(strip_tags(&block[content_start..content_end]))
}

fn strip_tags(input: &str) -> String {
    let mut result = String::new();
    let mut in_tag = false;
    for character in input.chars() {
        match character {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => result.push(character),
            _ => {}
        }
    }
    html_decode(result.trim())
}

fn html_decode(input: &str) -> String {
    input
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&#x27;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&nbsp;", " ")
}

fn all_hrefs(block: &str) -> Vec<String> {
    let mut values = Vec::new();
    let mut cursor = block;
    while let Some(index) = cursor.find("href=\"") {
        cursor = &cursor[index + 6..];
        let Some(end) = cursor.find('"') else {
            break;
        };
        values.push(html_decode(&cursor[..end]));
        cursor = &cursor[end + 1..];
    }
    values
}

fn first_href_containing(block: &str, needle: &str) -> Option<String> {
    all_hrefs(block)
        .into_iter()
        .find(|href| href.contains(needle))
}

fn extract_query_value(block: &str, key: &str) -> Option<String> {
    let decoded = html_decode(block);
    let needle = format!("{key}=");
    let start = decoded.find(&needle)? + needle.len();
    let end = decoded[start..]
        .find(['&', '"', ' '])
        .map_or(decoded.len(), |offset| start + offset);
    Some(decoded[start..end].to_string())
}

fn fetch_text(url: Url, max_bytes: u64) -> Result<String, String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent("Pi Desktop/0.1")
        .build()
        .map_err(|error| error.to_string())?;
    let response = client
        .get(url)
        .send()
        .map_err(|error| format!("Network request failed: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Remote service returned an error: {error}"))?;
    let mut bytes = Vec::new();
    response
        .take(max_bytes + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > max_bytes {
        return Err("Remote response exceeded the safety limit".into());
    }
    String::from_utf8(bytes).map_err(|error| format!("Remote response was not UTF-8: {error}"))
}

fn write_private_json(path: &Path, value: &Value) -> Result<(), String> {
    let encoded = serde_json::to_vec_pretty(value).map_err(|error| error.to_string())?;
    let mut file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .mode(0o600)
        .open(path)
        .map_err(|error| error.to_string())?;
    file.write_all(&encoded)
        .map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())
}

fn validate_package_name(name: &str) -> Result<(), String> {
    fn valid_segment(segment: &str) -> bool {
        !segment.is_empty()
            && segment.len() <= 214
            && segment
                .chars()
                .next()
                .is_some_and(|character| character.is_ascii_alphanumeric())
            && segment
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || "._~-".contains(character))
            && !segment.contains("..")
    }

    let valid = if let Some(scoped) = name.strip_prefix('@') {
        scoped.split_once('/').is_some_and(|(scope, package)| {
            !package.contains('/') && valid_segment(scope) && valid_segment(package)
        })
    } else {
        !name.contains('/') && valid_segment(name)
    };
    if valid {
        Ok(())
    } else {
        Err("Invalid npm package name".into())
    }
}

fn validate_version(version: &str) -> Result<(), String> {
    if version.len() <= 64 && Version::parse(version).is_ok() {
        Ok(())
    } else {
        Err("Invalid npm package version".into())
    }
}

fn unix_millis() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_official_catalog_card_without_executing_html() {
        let html = r#"
          <article data-package-card="true" data-package-name="@scope/pi-tools"
            data-package-types="extension skill" data-package-downloads="1234"
            data-package-date="4567">
            <h3><a href="/packages/@scope/pi-tools?type=extension">Tools</a></h3>
            <p class="packages-desc">Safer &amp; faster tools.</p>
            <div class="packages-meta"><span>author</span><span>1.2K/mo</span></div>
            <a href="https://www.npmjs.com/package/@scope/pi-tools">npm</a>
            <a href="https://github.com/acme/pi-tools">repo</a>
            <a href="https://github.com/earendil-works/pi/issues/new?package-version=1.2.3">report</a>
          </article>
          <a href="/packages?type=extension&amp;page=7">7</a>
        "#;
        let (packages, pages) = parse_catalog(html);
        assert_eq!(pages, 7);
        assert_eq!(packages.len(), 1);
        assert_eq!(packages[0].name, "@scope/pi-tools");
        assert_eq!(packages[0].version, "1.2.3");
        assert_eq!(packages[0].description, "Safer & faster tools.");
        assert_eq!(
            packages[0].repository_url.as_deref(),
            Some("https://github.com/acme/pi-tools")
        );
    }

    #[test]
    fn rejects_package_name_shell_metacharacters() {
        assert!(validate_package_name("@scope/good-package").is_ok());
        assert!(validate_package_name("good-package").is_ok());
        assert!(validate_package_name("bad;touch").is_err());
        assert!(validate_package_name("../escape").is_err());
        assert!(validate_package_name("/absolute").is_err());
        assert!(validate_package_name("unscoped/path").is_err());
        assert!(validate_package_name("@scope/nested/path").is_err());
        assert!(validate_version("1.2.3-beta.1").is_ok());
        assert!(validate_version("..").is_err());
    }

    #[test]
    #[ignore = "requires the live Pi catalog"]
    fn fetches_live_official_extension_catalog() {
        let page = fetch_catalog(MarketplaceQuery {
            search: Some("mcp".into()),
            page: Some(1),
            sort: Some(MarketplaceSort::Downloads),
        })
        .expect("official catalog should be reachable");
        assert_eq!(page.source, "pi.dev");
        assert!(!page.packages.is_empty());
        assert!(page
            .packages
            .iter()
            .all(|package| package.types.iter().any(|kind| kind == "extension")));
    }
}
