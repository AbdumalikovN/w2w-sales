/* Ставит тему до первой отрисовки, уводит со старого адреса на рабочий и не даёт встроить CRM в чужой сайт. */
(function () {
  if (window.top !== window.self) {
    document.documentElement.style.display = "none";
    try { window.top.location = window.location.href; } catch (e) {}
    return;
  }
  try {
    var t = localStorage.getItem("w2w-theme");
    var dark = t ? t === "dark" : window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  } catch (e) {}
  if (/\.github\.io$/.test(location.hostname)) {
    var target = "https://w2w-crm.netlify.app/" + location.hash;
    document.documentElement.dataset.redirect = target;
    location.replace(target);
  }
})();
