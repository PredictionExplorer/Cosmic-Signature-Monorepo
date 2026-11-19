"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

/** Reserve the output before a chain operation and publish the complete report without replacing any existing file. */
async function withNewReport(reportPath_, operation_) {
	const directory_ = path.dirname(reportPath_);
	const pending_ = reportPath_ + ".pending";
	const draft_ = path.join(pending_, "report.json");
	const partial_ = draft_ + ".partial";
	let keepReservation_ = false;
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
			let json_;
			try {
				json_ = JSON.stringify(report_, null, 3);
				// The pending directory is private. The published address report follows the operator's umask.
				await fs.writeFile(partial_, json_, { flag: "wx" });
				await fs.rename(partial_, draft_);
				await fs.link(draft_, reportPath_);
			} catch (error_) {
				// The chain operation produced a report. Keep its reservation and any evidence
				// so a failed filesystem operation cannot allow an automatic second deployment.
				keepReservation_ = true;
				console.error('Report publication failed. Reconcile "%s" with the transaction receipts before retrying.', pending_);
				if (json_ !== undefined) {
					console.info("Report:");
					console.info("%s", json_);
				}
				throw error_;
			}
		});
	} finally {
		if ( ! keepReservation_ ) {
			await fs.rm(draft_, { force: true });
			await fs.rmdir(pending_);
		}
	}
}

module.exports = { withNewReport };
