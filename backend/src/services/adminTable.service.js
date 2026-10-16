import mongoose from "mongoose";

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const relation = (path, model, fields) => ({ path, model, fields });

// Only these public fields can be searched or sorted by a table request.
export const ADMIN_TABLES = {
  IntegrityCheck: {
    fields: ["result", "reasonCode", "checkType", "integrityStatus", "createdAt"],
    relations: [], defaultSort: { createdAt: -1, _id: -1 }
  },
  ChannelPartner: {
    fields: ["name", "type", "contactEmail", "contactPhone", "address.city", "isActive", "createdAt"],
    relations: [], defaultSort: { createdAt: -1, _id: -1 }
  },
  Tenant: {
    fields: ["name", "type", "pocName", "supportPhone", "address.district", "isActive", "createdAt"],
    relations: [relation("channelPartnerId", "ChannelPartner", "name type")], defaultSort: { createdAt: -1, _id: -1 }
  },
  Account: {
    fields: ["name", "email", "mobile", "role", "isActive", "createdAt"],
    relations: [relation("tenantId", "Tenant", "name type"), relation("channelPartnerId", "ChannelPartner", "name type")],
    exclude: "-passwordHash", defaultSort: { createdAt: -1, _id: -1 }
  },
  ConsentVersion: {
    fields: ["version", "title", "isCurrent", "publishedAt", "createdAt"],
    relations: [], defaultSort: { createdAt: -1, _id: -1 }
  },
  UnlockRequest: {
    fields: ["caseId", "status", "createdAt"],
    relations: [relation("userId", "User", "name mobile"), relation("deviceId", "Device", "imei deviceModel manufacturer state enrollmentMode"), relation("tenantId", "Tenant", "name"), relation("channelPartnerId", "ChannelPartner", "name")],
    defaultSort: { escalatedToAdminAt: -1, escalatedToPartnerAt: -1, createdAt: -1, _id: -1 }
  },
  Device: {
    fields: ["imei", "imei2", "deviceModel", "manufacturer", "enrollmentMode", "state", "updatedAt"],
    computedSorts: ["provisioningLabel", "dealerModeLabel"],
    relations: [relation("userId", "User", "name mobile"), relation("tenantId", "Tenant", "name channelPartnerId")],
    defaultSort: { updatedAt: -1, _id: -1 }
  },
  DeviceCommand: {
    fields: ["commandType", "status", "triggeredBy", "sentAt", "acknowledgedAt", "createdAt"],
    relations: [relation("deviceId", "Device", "imei deviceModel manufacturer state userId"), relation("tenantId", "Tenant", "name"), relation("triggeredByAccountId", "Account", "name email role")],
    defaultSort: { createdAt: -1, _id: -1 }
  },
  AuditLog: {
    fields: ["eventType", "caseId", "reason", "timestamp"],
    relations: [relation("actorId", "Account", "name email"), relation("tenantId", "Tenant", "name"), relation("channelPartnerId", "ChannelPartner", "name")],
    defaultSort: { timestamp: -1, _id: -1 }
  },
  RiskFlag: {
    fields: ["type", "riskType", "message", "caseId", "severity", "status", "riskBucket", "createdAt", "updatedAt", "lastDetectedAt"],
    relations: [relation("tenantId", "Tenant", "name"), relation("deviceId", "Device", "imei deviceModel manufacturer state deviceSecurityState enrollmentMode"), relation("userId", "User", "name mobile loanId"), relation("acknowledgedBy", "Account", "name email role"), relation("clearedBy", "Account", "name email role")],
    defaultSort: { createdAt: -1, _id: -1 }
  }
};

export const getAdminTableSort = (config, query) => {
  const allowed = [
    ...config.fields,
    ...(config.computedSorts || []),
    ...config.relations.flatMap((entry) => entry.fields.split(" ").map((field) => `${entry.path}.${field}`))
  ];
  if (!allowed.includes(query.sortBy)) return config.defaultSort;
  return { [query.sortBy]: query.sortOrder === "asc" ? 1 : -1, _id: -1 };
};

export const findAdminTablePage = async ({ model, filter, query, page, limit, skip }) => {
  const config = ADMIN_TABLES[model.modelName];
  const search = String(query.search || "").trim();
  let combinedFilter = filter;
  if (search) {
    const regex = new RegExp(escapeRegex(search), "i");
    const alternatives = config.fields
      .filter((field) => model.schema.path(field)?.instance === "String")
      .map((field) => ({ [field]: regex }));
    if (/^(active|inactive)$/i.test(search) && config.fields.includes("isActive")) {
      alternatives.push({ isActive: search.toLowerCase() === "active" });
    }
    if (/^(true|false)$/i.test(search) && config.fields.includes("isCurrent")) {
      alternatives.push({ isCurrent: search.toLowerCase() === "true" });
    }
    const relatedMatches = await Promise.all(config.relations.map(async (entry) => {
      const relatedModel = mongoose.model(entry.model);
      const fields = entry.fields.split(" ").filter((field) => relatedModel.schema.path(field)?.instance === "String");
      if (!fields.length) return null;
      const matches = await relatedModel.find({ $or: fields.map((field) => ({ [field]: regex })) }).select("_id").lean();
      return { [entry.path]: { $in: matches.map((item) => item._id) } };
    }));
    alternatives.push(...relatedMatches.filter(Boolean));
    if (model.modelName === "Device") {
      if (regex.test("Running provisioned")) alternatives.push({ enrollmentMode: "RUNNING_APP" });
      if (regex.test("QR provisioned")) alternatives.push({ enrollmentMode: { $ne: "RUNNING_APP" } });
      if (regex.test("Manual") || regex.test("Automatic")) {
        const manualPolicies = await mongoose.model("TenantPolicy").find({ "deviceControlRules.mode": "MANUAL" }).select("tenantId").lean();
        const tenantIds = manualPolicies.map((policy) => policy.tenantId);
        if (regex.test("Manual")) alternatives.push({ tenantId: { $in: tenantIds } });
        if (regex.test("Automatic")) alternatives.push({ tenantId: { $nin: tenantIds } });
      }
    }
    combinedFilter = { $and: [filter, { $or: alternatives }] };
  }

  const sort = getAdminTableSort(config, query);
  const sortField = Object.keys(sort)[0];
  const joinedSort = config.relations.find((entry) => sortField.startsWith(`${entry.path}.`));
  const populate = config.relations.map((entry) => ({ path: entry.path, model: entry.model, select: entry.fields }));
  let itemsPromise;
  if (joinedSort || config.computedSorts?.includes(sortField)) {
    // Aggregate only for a joined sort; populate the selected page afterwards.
    // Mongoose does not cast aggregation filters automatically.
    const castFilter = model.find(combinedFilter).cast(model);
    const join = joinedSort || { model: "TenantPolicy", path: "tenantId" };
    const foreignField = joinedSort ? sortField.slice(joinedSort.path.length + 1) : "deviceControlRules.mode";
    const sortExpression = sortField === "provisioningLabel"
      ? { $cond: [{ $eq: ["$enrollmentMode", "RUNNING_APP"] }, "Running provisioned", "QR provisioned"] }
      : sortField === "dealerModeLabel"
        ? { $cond: [{ $eq: [{ $arrayElemAt: ["$__tableRelation.deviceControlRules.mode", 0] }, "MANUAL"] }, "Manual", "Automatic"] }
        : { $arrayElemAt: [`$__tableRelation.${foreignField}`, 0] };
    const projection = { __tableRelation: 0, __tableSort: 0 };
    if (config.exclude) projection[config.exclude.slice(1)] = 0;
    itemsPromise = model.aggregate([
      { $match: castFilter },
      ...(sortField === "provisioningLabel" ? [] : [{ $lookup: { from: mongoose.model(join.model).collection.name, localField: join.path, foreignField: sortField === "dealerModeLabel" ? "tenantId" : "_id", as: "__tableRelation" } }]),
      { $set: { __tableSort: sortExpression } },
      { $sort: { __tableSort: sort[sortField], _id: -1 } },
      { $skip: skip }, { $limit: limit }, { $project: projection }
    ]).then((items) => model.populate(items, populate));
  } else {
    let find = model.find(combinedFilter);
    if (config.exclude) find = find.select(config.exclude);
    itemsPromise = find.populate(populate).sort(sort).skip(skip).limit(limit).lean();
  }
  const [items, total] = await Promise.all([itemsPromise, model.countDocuments(combinedFilter)]);
  return { items, total, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
};
