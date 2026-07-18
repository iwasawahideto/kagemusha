import { spawn } from "node:child_process";

// Open a file with the OS's default viewer (Preview on macOS, etc.).
// `detached + unref` lets the kagemusha process exit while the viewer keeps
// running. We deliberately avoid `shell: true` so paths with spaces don't get
// re-split — argv is passed straight through to the program.
export const openInDefaultApp = (filePath: string): void => {
	if (process.platform === "darwin") {
		spawn("open", [filePath], { detached: true, stdio: "ignore" }).unref();
	} else if (process.platform === "win32") {
		// `start` is a cmd.exe builtin; we invoke cmd directly. The empty
		// string after `start` is the (required) window title placeholder.
		spawn("cmd", ["/c", "start", "", filePath], {
			detached: true,
			stdio: "ignore",
		}).unref();
	} else {
		spawn("xdg-open", [filePath], { detached: true, stdio: "ignore" }).unref();
	}
};
