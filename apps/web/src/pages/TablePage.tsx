import { HandStrip } from "../components/HandStrip";
import { TableTopBar } from "../components/TableTopBar";
import { TableScene } from "../scene/TableScene";

export function TablePage() {
  return <TableScene topBar={<TableTopBar />} hand={<HandStrip />} />;
}
