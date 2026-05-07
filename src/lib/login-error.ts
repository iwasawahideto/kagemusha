/**
 * Marker error thrown by `kagemusha login` after it has already printed a
 * friendly diagnostic + screenshot path to stderr. Callers (e.g. capture)
 * should treat this as "already explained, just exit" — no extra log, no
 * stack trace.
 */
export class LoginError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "LoginError";
	}
}
