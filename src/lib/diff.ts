import { compare, type ODiffOptions, type ODiffResult } from "odiff-bin";

export type DiffStatus =
	| { id: string; status: "unchanged" }
	| { id: string; status: "new" }
	| { id: string; status: "missing" }
	| {
			id: string;
			status: "changed";
			reason: "pixel-diff" | "layout-diff";
			diffPercentage?: number;
			diffPath?: string;
	  };

export const diffImages = async (
	baseline: string,
	current: string,
	diffPath: string,
	options?: ODiffOptions,
): Promise<ODiffResult> =>
	compare(baseline, current, diffPath, {
		// anti-aliasing は必ず無視 — pixel diff の偽陽性削減で最低限必要
		antialiasing: true,
		...options,
	});
