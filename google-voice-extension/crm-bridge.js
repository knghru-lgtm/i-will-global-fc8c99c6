(function () {
  if (window !== window.top) return;
  try {
    document.documentElement.setAttribute('data-iwg-gv-extension', 'active');
  } catch { }
})();
