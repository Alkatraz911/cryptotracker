// Test what the EIP-1967 impl slot returns for the deBridge proxy
const rpc = "https://arb1.arbitrum.io/rpc";
const address = "0x663DC15D3C1aC63ff12E45Ab68FeA3F0a883C251";
const EIP1967_IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

const r = await fetch(rpc, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getStorageAt", params: [address, EIP1967_IMPL_SLOT, "latest"] })
});
const j = await r.json();
const slotVal = j.result;
console.log("slot value:", slotVal);
const implAddr = "0x" + slotVal.slice(-40);
console.log("implementation:", implAddr);
