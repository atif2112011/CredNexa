import { ENROLLMENT_MODES, getEnrollmentMode } from "../../constants/enrollmentModes.js";
import { TENANT_CAPABILITIES } from "../../constants/tenant.js";
import { isTestBorrowerName } from "../../constants/testBorrowers.js";
import { Device } from "../../models/Device.js";
import { Tenant } from "../../models/Tenant.js";
import { TenantPolicy } from "../../models/TenantPolicy.js";
import { User } from "../../models/User.js";
import { sendError, sendSuccess } from "../../utils/apiResponse.js";
import { isValidObjectId } from "../../utils/validators.js";
import { getTenantDeviceControlMode } from "../../services/tenantDeviceControl.service.js";
import { MOCK_OTP } from "../../services/otp.service.js";
import { getBorrowerEnrollmentQr } from "../../services/borrowerEnrollment.service.js";
import {
  assertDevQrConfigured, createDevTestBorrower, devPagination, devPaginationResult,
  escapeDevSearch, getDevDealer, testBorrowerFilter, validateDevEnrollmentMode
} from "../../services/adminDevTools.service.js";

const fail = (res, error) => sendError(res, error.statusCode || 500, error.message || "Internal server error", error.data);

export const listDevDealers = async (req, res) => {
  try {
    const mode = validateDevEnrollmentMode(req.query.enrollmentMode);
    const { page, limit, skip } = devPagination(req.query);
    const filter = { isActive: true, capabilities: TENANT_CAPABILITIES.DISTRIBUTE };
    if (mode === ENROLLMENT_MODES.RUNNING_APP) {
      const enabled = await TenantPolicy.find({ runningEnrollmentEnabled: true }).select("tenantId").lean();
      filter._id = { $in: enabled.map((policy) => policy.tenantId) };
    }
    if (req.query.search) filter.name = escapeDevSearch(req.query.search);
    const [items, total] = await Promise.all([
      Tenant.find(filter).select("name creditBalance").sort({ name: 1, _id: 1 }).skip(skip).limit(limit).lean(),
      Tenant.countDocuments(filter)
    ]);
    const policies = await TenantPolicy.find({ tenantId: { $in: items.map((item) => item._id) } }).select("tenantId deviceControlRules").lean();
    const byTenant = new Map(policies.map((policy) => [String(policy.tenantId), policy]));
    return sendSuccess(res, 200, "Eligible dealers fetched", {
      items: items.map((item) => ({ ...item, deviceControlMode: getTenantDeviceControlMode(byTenant.get(String(item._id))) })),
      pagination: devPaginationResult(page, limit, total)
    });
  } catch (error) { return fail(res, error); }
};

export const registerDevTestBorrower = async (req, res) => {
  try {
    // Only these selectors come from the client; all identity/loan values and
    // the free-test service argument are chosen here on the trusted server.
    const result = await createDevTestBorrower({ tenantId: req.body.tenantId,
      enrollmentMode: req.body.enrollmentMode, actor: req.auth });
    return sendSuccess(res, result.statusCode, "Test borrower created without charging a dealer key", result.data);
  } catch (error) { return fail(res, error); }
};

export const listDevTestBorrowers = async (req, res) => {
  try {
    const { page, limit, skip } = devPagination(req.query);
    const filter = testBorrowerFilter();
    if (req.query.search) {
      const search = escapeDevSearch(req.query.search);
      const dealers = await Tenant.find({ name: search }).select("_id").lean();
      filter.$or = [{ name: search }, { mobile: search }, { loanId: search }, { tenantId: { $in: dealers.map((item) => item._id) } }];
    }
    const [items, total] = await Promise.all([
      User.find(filter).select("name mobile loanId enrollmentMode tenantId isActive isDeviceLinked linkedDeviceId createdAt")
        .populate("tenantId", "name").sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
      User.countDocuments(filter)
    ]);
    const tenantIds = items.map((user) => user.tenantId?._id || user.tenantId).filter(Boolean);
    const [devices, policies] = await Promise.all([
      Device.find({ userId: { $in: items.map((user) => user._id) } }).select("userId tenantId state").lean(),
      TenantPolicy.find({ tenantId: { $in: tenantIds } }).select("tenantId deviceControlRules").lean()
    ]);
    const modes = new Map(policies.map((policy) => [String(policy.tenantId), getTenantDeviceControlMode(policy)]));
    return sendSuccess(res, 200, "Test borrowers fetched", {
      items: items.map((user) => {
        const tenantId = String(user.tenantId?._id || user.tenantId);
        const device = devices.find((item) => String(item.userId) === String(user._id) && String(item.tenantId) === tenantId);
        const linked = user.isDeviceLinked === true || Boolean(device);
        return { ...user, enrollmentMode: getEnrollmentMode(user), linkedDeviceId: device?._id || null,
          isDeviceLinked: linked, deviceControlMode: modes.get(tenantId) || getTenantDeviceControlMode(null),
          enrollmentStatus: device ? "PROVISIONED" : linked ? "LINKED_DEVICE_UNAVAILABLE" : !user.isActive ? "INACTIVE" : "PENDING_ENROLLMENT",
          canShowQr: user.isActive === true && !linked };
      }),
      pagination: devPaginationResult(page, limit, total), otp: MOCK_OTP
    });
  } catch (error) { return fail(res, error); }
};

export const showDevTestBorrowerQr = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.userId)) return sendError(res, 400, "Valid borrower ID is required");
    const user = await User.findOne({ _id: req.params.userId, ...testBorrowerFilter() }).lean();
    if (!user || !isTestBorrowerName(user.name) || !user.isActive) return sendError(res, 404, "Active test borrower not found");
    const mode = getEnrollmentMode(user);
    const { tenant } = await getDevDealer(user.tenantId, mode);
    await assertDevQrConfigured(mode);
    // Derive mode from storage; UI inputs cannot switch the saved QR format or
    // force rotation of a valid token. Shared renewal preserves consent binding.
    const result = await getBorrowerEnrollmentQr({ tenant, actor: req.auth, userId: user._id,
      body: { enrollmentMode: mode } });
    return sendSuccess(res, result.statusCode, result.message, { ...result.data, enrollmentMode: mode, otp: MOCK_OTP });
  } catch (error) { return fail(res, error); }
};
