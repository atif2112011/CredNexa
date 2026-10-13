import { env } from "../config/env.js";
import { ENROLLMENT_MODES } from "../constants/enrollmentModes.js";
import { TEST_BORROWER_PATTERN, createTestBorrowerName } from "../constants/testBorrowers.js";
import { TENANT_CAPABILITIES } from "../constants/tenant.js";
import { Account } from "../models/Account.js";
import { ProvisioningDetails } from "../models/ProvisioningDetails.js";
import { Tenant } from "../models/Tenant.js";
import { TenantPolicy } from "../models/TenantPolicy.js";
import { User } from "../models/User.js";
import { isValidObjectId } from "../utils/validators.js";
import { createBorrowerEnrollment, enrollmentError } from "./borrowerEnrollment.service.js";
import { MOCK_OTP, normalizeMobileForOtpRouting } from "./otp.service.js";
import { assertRunningEnrollmentConfigured } from "./runningEnrollment.service.js";
import { getTenantDeviceControlMode } from "./tenantDeviceControl.service.js";

export const validateDevEnrollmentMode = (mode) => {
  if (!Object.values(ENROLLMENT_MODES).includes(mode)) throw enrollmentError(400, "Invalid enrollmentMode");
  return mode;
};

export const escapeDevSearch = (value) => new RegExp(String(value || "").trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
export const devPagination = (query = {}) => {
  const page = Number.isFinite(Number(query.page)) ? Math.max(1, Math.floor(Number(query.page))) : 1;
  const limit = Number.isFinite(Number(query.limit)) ? Math.min(100, Math.max(1, Math.floor(Number(query.limit)))) : 20;
  return { page, limit, skip: (page - 1) * limit };
};
export const devPaginationResult = (page, limit, total) => ({ page, limit, total, pages: Math.ceil(total / limit) || 1 });

export const getDevDealer = async (tenantId, enrollmentMode) => {
  validateDevEnrollmentMode(enrollmentMode);
  if (!isValidObjectId(tenantId)) throw enrollmentError(400, "Valid tenantId is required");
  const tenant = await Tenant.findById(tenantId).lean();
  if (!tenant) throw enrollmentError(404, "Dealer not found");
  if (!tenant.isActive || !tenant.capabilities?.includes(TENANT_CAPABILITIES.DISTRIBUTE)) {
    throw enrollmentError(409, "An active dealer with distribution capability is required", { code: "DEALER_NOT_ELIGIBLE" });
  }
  const policy = await TenantPolicy.findOne({ tenantId: tenant._id }).select("runningEnrollmentEnabled deviceControlRules").lean();
  if (enrollmentMode === ENROLLMENT_MODES.RUNNING_APP && policy?.runningEnrollmentEnabled !== true) {
    throw enrollmentError(409, "Running enrollment is disabled for this dealer", { code: "RUNNING_ENROLLMENT_DISABLED" });
  }
  return { tenant, deviceControlMode: getTenantDeviceControlMode(policy) };
};

export const assertDevQrConfigured = async (mode) => {
  if (mode === ENROLLMENT_MODES.RUNNING_APP) {
    try { assertRunningEnrollmentConfigured(); }
    catch (error) { throw enrollmentError(409, error.message, { code: "RUNNING_ENROLLMENT_NOT_CONFIGURED" }); }
    return;
  }
  const details = await ProvisioningDetails.findOne({}).lean();
  const ready = [details?.adminComponentName, details?.adminPackageDownloadUrl, details?.adminSignatureChecksum]
    .every((value) => typeof value === "string" && value.trim());
  if (!ready) throw enrollmentError(409, "Device Owner provisioning details must be configured before creating or displaying a test QR", { code: "OWNER_PROVISIONING_NOT_CONFIGURED" });
};

export const getTestMobileCandidates = (prefix = env.testOtpMobilePrefix) => {
  if (!/^\d{8}$/.test(prefix || "")) throw enrollmentError(409, "Configure TEST_OTP_MOBILE_PREFIX before creating a test borrower", { code: "TEST_MOBILE_RANGE_NOT_CONFIGURED" });
  return Array.from({ length: 100 }, (_, index) => prefix + String(index).padStart(2, "0"));
};

export const createDevTestBorrower = async ({ tenantId, enrollmentMode, actor }) => {
  const { tenant, deviceControlMode } = await getDevDealer(tenantId, enrollmentMode);
  await assertDevQrConfigured(enrollmentMode);
  const candidates = getTestMobileCandidates();
  const blocked = new Set();
  // The User mobile unique index is the final arbiter if two admins allocate
  // the same candidate. An aborted transaction is retried with another number.
  for (let attempt = 0; attempt < candidates.length; attempt += 1) {
    const filter = { mobile: { $regex: env.testOtpMobilePrefix } };
    const [users, accounts] = await Promise.all([
      User.find(filter).select("mobile").lean(), Account.find(filter).select("mobile").lean()
    ]);
    for (const entry of [...users, ...accounts]) blocked.add(normalizeMobileForOtpRouting(entry.mobile));
    const mobile = candidates.find((candidate) => !blocked.has(candidate));
    if (!mobile) break;
    const body = {
      name: createTestBorrowerName(enrollmentMode), mobile, aadhaarLinkedMobile: mobile,
      loanAmount: 12000, emiAmount: 2000, tenureMonths: 6,
      disbursementDate: new Date().toISOString().slice(0, 10), enrollmentMode
    };
    try {
      const created = await createBorrowerEnrollment({ tenant, actor, body, freeTest: true });
      return { ...created, data: { ...created.data, creditsCharged: 0, otp: MOCK_OTP,
        borrower: { id: created.data.userId, ...body, loanId: created.data.loanId, deviceControlMode } } };
    } catch (error) {
      const collision = (error.code === 11000 && (error.keyPattern?.mobile || error.message?.includes("mobile")))
        || (error.statusCode === 400 && error.message === "User mobile already exists");
      if (!collision) throw error;
      blocked.add(mobile);
    }
  }
  throw enrollmentError(409, "All 100 test mobiles are already in use", { code: "TEST_MOBILE_RANGE_EXHAUSTED" });
};

export const testBorrowerFilter = () => ({ name: { $regex: TEST_BORROWER_PATTERN } });
