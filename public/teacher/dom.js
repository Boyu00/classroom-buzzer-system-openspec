// 建立 DOM 的小工具：所有文字一律以文字節點加入（等同 textContent），不使用 innerHTML，
// 避免組名、答案或試算表內容被當成 HTML／腳本執行（AC-16）。
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (key === 'value' || key === 'checked' || key === 'disabled' || key === 'hidden') node[key] = value;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

// 取代 parent 的所有子節點。會展開陣列並略過 null／undefined／false，
// 避免 replaceChildren 把它們當成文字（例如字面上的 "null"、"[object HTMLElement]"）。
export function mount(parent, ...children) {
  const nodes = children.flat(Infinity)
    .filter((child) => child !== null && child !== undefined && child !== false)
    .map((child) => (child instanceof Node ? child : document.createTextNode(String(child))));
  parent.replaceChildren(...nodes);
}
