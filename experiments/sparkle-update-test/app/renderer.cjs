const version = document.querySelector("#version");
const state = document.querySelector("#state");

async function refresh() {
  const snapshot = await window.sparkleTest.snapshot();
  version.textContent = `当前真实版本：v${snapshot.version}`;
  state.textContent = JSON.stringify(snapshot, null, 2);
}

document.querySelector("#check").addEventListener("click", () => window.sparkleTest.check());
document.querySelector("#install").addEventListener("click", () => window.sparkleTest.installNow());
document.querySelector("#cancel").addEventListener("click", () => window.sparkleTest.cancel());

refresh();
setInterval(refresh, 500);
