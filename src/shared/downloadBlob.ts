/** 받은 파일(Blob)을 이 이름으로 내려받게 한다. 링크를 잠깐 만들어 누르고, 10초 뒤 메모리에서 지운다. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
