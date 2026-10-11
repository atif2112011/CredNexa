import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";

import { deleteConsentVersion } from "../src/modules/admin/admin.controller.js";
import { AuditLog } from "../src/models/AuditLog.js";
import { ConsentRecord } from "../src/models/ConsentRecord.js";
import { ConsentVersion } from "../src/models/ConsentVersion.js";

test("consent deletion removes only an unaccepted draft and records an audit event", async () => {
  const original = {
    findById: ConsentVersion.findById,
    deleteOne: ConsentVersion.deleteOne,
    exists: ConsentRecord.exists,
    auditCreate: AuditLog.create,
    log: console.log,
    error: console.error
  };
  const id = new mongoose.Types.ObjectId();
  let consent = { _id: id, version: "running-draft-1", enrollmentMode: "RUNNING_APP", isCurrent: false };
  let accepted = false;
  let deletions = 0;
  let audits = 0;
  const response = () => ({
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; }
  });
  try {
    console.log = () => {};
    console.error = () => {};
    ConsentVersion.findById = () => ({ lean: async () => consent });
    ConsentVersion.deleteOne = async (filter) => {
      assert.equal(String(filter._id), String(id));
      deletions += 1;
      return { deletedCount: 1 };
    };
    ConsentRecord.exists = async () => accepted;
    AuditLog.create = async () => { audits += 1; return [{}]; };

    const req = { params: { id: String(id) }, auth: { id: new mongoose.Types.ObjectId() } };
    const draft = response();
    await deleteConsentVersion(req, draft);
    assert.equal(draft.code, 200);
    assert.equal(deletions, 1);
    assert.equal(audits, 1);

    consent = { ...consent, publishedAt: new Date() };
    const published = response();
    await deleteConsentVersion(req, published);
    assert.equal(published.code, 409);
    assert.equal(deletions, 1);

    consent = { ...consent, publishedAt: undefined };
    accepted = true;
    const usedDraft = response();
    await deleteConsentVersion(req, usedDraft);
    assert.equal(usedDraft.code, 409);
    assert.equal(deletions, 1);
  } finally {
    ConsentVersion.findById = original.findById;
    ConsentVersion.deleteOne = original.deleteOne;
    ConsentRecord.exists = original.exists;
    AuditLog.create = original.auditCreate;
    console.log = original.log;
    console.error = original.error;
  }
});
