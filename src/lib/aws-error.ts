import chalk from "chalk";

const errorName = (e: unknown): string =>
	typeof e === "object" && e !== null
		? ((e as { name?: string }).name ?? "")
		: "";
const errorCode = (e: unknown): string =>
	typeof e === "object" && e !== null
		? ((e as { Code?: string }).Code ?? "")
		: "";
const errorMessage = (e: unknown): string =>
	typeof e === "object" && e !== null
		? ((e as { message?: string }).message ?? "")
		: "";

const matchesAuthError = (e: unknown): boolean => {
	const name = errorName(e);
	const code = errorCode(e);
	const message = errorMessage(e);

	if (name === "CredentialsProviderError") return true;
	if (name === "ExpiredToken" || name === "ExpiredTokenException") return true;
	if (code === "ExpiredToken" || code === "ExpiredTokenException") return true;
	if (/token (is )?expired/i.test(message)) return true;
	if (/credentials.*expired/i.test(message)) return true;
	return false;
};

const matchesAccessDeniedError = (e: unknown): boolean => {
	const name = errorName(e);
	const code = errorCode(e);
	return name === "AccessDenied" || code === "AccessDenied";
};

const matchesNoSuchBucket = (e: unknown): boolean => {
	const name = errorName(e);
	const code = errorCode(e);
	return name === "NoSuchBucket" || code === "NoSuchBucket";
};

const profileLabel = (): string => process.env.AWS_PROFILE ?? "(default)";

/**
 * If `e` is a recognizable AWS error, print a friendly hint and return true.
 * The caller is responsible for setting `process.exitCode` and returning.
 * If the error isn't recognized, returns false — the caller should rethrow.
 */
export const handleAwsError = (e: unknown): boolean => {
	if (matchesAuthError(e)) {
		const profile = profileLabel();
		console.error("");
		console.error(chalk.red(`✗ AWS authentication failed: ${errorMessage(e)}`));
		console.error(chalk.yellow("\nHint:"));
		console.error(chalk.gray(`  - Run: aws sso login --profile ${profile}`));
		console.error(
			chalk.gray(
				`  - Or refresh credentials for the active profile (AWS_PROFILE=${profile})`,
			),
		);
		console.error("");
		return true;
	}

	if (matchesAccessDeniedError(e)) {
		const profile = profileLabel();
		console.error("");
		console.error(chalk.red(`✗ AWS access denied: ${errorMessage(e)}`));
		console.error(chalk.yellow("\nHint:"));
		console.error(chalk.gray(`  - Active profile: AWS_PROFILE=${profile}`));
		console.error(
			chalk.gray(
				`  - Verify the IAM principal has s3:GetObject / s3:PutObject on the target bucket`,
			),
		);
		console.error("");
		return true;
	}

	if (matchesNoSuchBucket(e)) {
		console.error("");
		console.error(chalk.red(`✗ S3 bucket not found: ${errorMessage(e)}`));
		console.error(chalk.yellow("\nHint:"));
		console.error(
			chalk.gray("  - Check publish.cdnBucket in kagemusha.config.yaml"),
		);
		console.error("");
		return true;
	}

	return false;
};
