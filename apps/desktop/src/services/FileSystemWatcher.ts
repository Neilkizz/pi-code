export class FileSystemWatcher {
  private onChangeCallbacks: Array<() => void> = [];

  onChange(cb: () => void) {
    this.onChangeCallbacks.push(cb);
  }

  notifyChange() {
    this.invalidateCache();
    this.onChangeCallbacks.forEach((cb) => cb());
  }

  private invalidateCache() {}
}
