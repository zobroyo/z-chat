function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderMarkdown(text) {
  let s = escapeHtml(text || "");
  const codeBlocks = [];
  const inlineCodes = [];

  s = s.replace(/```([\s\S]*?)```/g, (m, code) => {
    codeBlocks.push(code.replace(/^\n+|\n+$/g, ""));
    return "\u0000CB" + (codeBlocks.length - 1) + "\u0000";
  });
  s = s.replace(/`([^`\n]+)`/g, (m, code) => {
    inlineCodes.push(code);
    return "\u0000IC" + (inlineCodes.length - 1) + "\u0000";
  });

  s = s.replace(/^### (.+)$/gm, '<div class="md-h3">$1</div>');
  s = s.replace(/^## (.+)$/gm, '<div class="md-h2">$1</div>');
  s = s.replace(/^# (.+)$/gm, '<div class="md-h1">$1</div>');
  s = s.replace(/^-# (.+)$/gm, '<div class="md-subtext">$1</div>');
  s = s.replace(/^&gt; (.+)$/gm, '<blockquote class="md-quote">$1</blockquote>');

  s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__([^_\n]+)__/g, "<u>$1</u>");
  s = s.replace(/~~([^~\n]+)~~/g, "<s>$1</s>");
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  s = s.replace(/(^|[^_\w])_([^_\n]+)_/g, "$1<em>$2</em>");

  s = s.replace(/\|\|([\s\S]+?)\|\|/g, '<span class="md-spoiler" data-spoiler>$1</span>');
  s = s.replace(/(https?:\/\/[^\s<&]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');

  s = s.replace(/\u0000IC(\d+)\u0000/g, (m, i) => '<code class="md-code">' + inlineCodes[+i] + "</code>");
  s = s.replace(/\u0000CB(\d+)\u0000/g, (m, i) => '<pre class="md-pre"><code>' + codeBlocks[+i] + "</code></pre>");

  return s;
}

function avatarColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return "hsl(" + hue + ", 55%, 45%)";
}

function avatarInitial(name) {
  return (name || "?").trim().charAt(0).toUpperCase();
}
