"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

/** Reserve the output before a chain operation and publish the complete report without replacing any existing file. */
async function withNewReport(reportPath_, operation_) {
	const directory_ = path.dirname(reportPath_);
	const pending_ = reportPath_ + ".pending";
	const draft_ = path.join(pending_, "report.json");
	await fs.mkdir(directory_, { recursive: true });
	try {
		await fs.mkdir(pending_, { mode: 0o700 });
	} catch (error_) {
		if (error_.code === "EEXIST") throw new Error(`A report operation is already pending at "${pending_}".`);
		throw error_;
	}
	try {
		try {
			await fs.lstat(reportPath_);
			throw new Error(`"${reportPath_}" already exists.`);
		} catch (error_) {
			if (error_.code !== "ENOENT") throw error_;
		}
		return await operation_(async (report_) => {
			const json_ = JSON.stringify(report_, null, 3);
			try {
				await fs.writeFile(draft_, json_, { flag: "wx", mode: 0o600 });
				await fs.link(draft_, reportPath_);
			} catch (error_) {
				console.info("Report:");
				console.info("%s", json_);
				throw error_;
			}
		});
	} finally {
		await fs.rm(draft_, { force: true });
		await fs.rmdir(pending_);
	}
}

module.exports = { withNewReport };
