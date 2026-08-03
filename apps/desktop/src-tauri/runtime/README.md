# Bundled runtime staging area

`npm run runtime:stage` places the release-only Node binary and compiled
`pi-agent-host` tree here. Generated runtime files are ignored by Git.

Development builds launch the locally installed Node binary. Release builds
resolve only this bundled runtime and therefore do not require Node or the Pi
CLI on the user's Mac.
