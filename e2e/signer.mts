import { loadAccount, signReceiptMessage } from "../scripts/chain";
const acc = await loadAccount();
const [chainId, data] = [process.argv[2], Buffer.from(process.argv[3], "base64").toString("utf8")];
process.stdout.write(JSON.stringify({ address: acc.cosmos, sig: data ? signReceiptMessage(acc, chainId, data) : null }));
