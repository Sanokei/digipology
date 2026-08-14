import { syncRepositoryDocs } from "../src/lib/docs-sync";

const published = syncRepositoryDocs();
console.log(`Synced ${published.length} repository docs: ${published.join(", ")}`);
