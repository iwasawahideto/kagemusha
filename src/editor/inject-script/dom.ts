// DOM helpers shared by all modules. Pure-ish — depends only on the document
// global, no internal editor state.

export const getMousePos = (e: MouseEvent): { x: number; y: number } => ({
	x: e.pageX,
	y: e.pageY,
});

export const measureSvgTextWidth = (
	svg: SVGElement,
	text: string,
	fontSize: number,
	svgNs: string,
): number => {
	const tmp = document.createElementNS(svgNs, "text");
	tmp.setAttribute("font-size", String(fontSize));
	tmp.setAttribute("font-family", "-apple-system, sans-serif");
	tmp.textContent = text;
	svg.appendChild(tmp);
	const width = (tmp as SVGTextElement).getBBox().width;
	tmp.remove();
	return width;
};

// In-page error toast — `window.alert()` would be auto-dismissed by
// Playwright's default dialog handler (= the user sees a flash they can't
// read). We render our own non-blocking toast under <html> so it can't be
// inert'd by host SPAs (same reason as the toolbar).
export const showErrorToast = (message: string, ms = 5000): void => {
	const toast = document.createElement("div");
	toast.setAttribute(
		"style",
		"position:fixed;top:72px;left:50%;transform:translateX(-50%);" +
			"background:#dc2626;color:#fff;padding:12px 20px;border-radius:8px;" +
			"font-family:-apple-system,sans-serif;font-size:14px;line-height:1.4;" +
			"z-index:var(--kg-z-top);box-shadow:0 4px 12px rgba(0,0,0,0.3);" +
			"max-width:480px;white-space:pre-wrap;text-align:center;",
	);
	toast.textContent = message;
	document.documentElement.appendChild(toast);
	setTimeout(() => toast.remove(), ms);
};
