/** A message that clears itself: `const saved = transient(); saved.show('Saved'); … {saved.text}`. */
export function transient(ms = 3000) {
  let text = $state('');
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    get text() {
      return text;
    },
    show(msg: string) {
      text = msg;
      clearTimeout(timer);
      timer = setTimeout(() => (text = ''), ms);
    },
    clear() {
      clearTimeout(timer);
      text = '';
    },
  };
}
