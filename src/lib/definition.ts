export const deriveIdFromPath = (urlPath: string): string =>
	urlPath
		.replace(/^\//, "")
		.replace(/\.\w+$/, "")
		.replace(/[/\\]/g, "-")
		.replace(/[^a-zA-Z0-9-]/g, "") || "page";
