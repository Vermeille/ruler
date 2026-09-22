// IndexedDB accommodates causal journals that exceed localStorage's small quota.
let database: Promise<IDBDatabase> | undefined;
function open(): Promise<IDBDatabase> {
  return database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('commonwealth', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('saves');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Another tab is blocking the save database.'));
  });
}
export async function loadAutosave(): Promise<string | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction('saves', 'readonly').objectStore('saves').get('current');
    request.onsuccess = () => resolve(request.result as string | undefined); request.onerror = () => reject(request.error);
  });
}
export async function storeAutosave(text: string): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('saves', 'readwrite');
    transaction.objectStore('saves').put(text, 'current');
    transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error);
  });
}
