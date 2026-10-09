import mongoose from "mongoose";

import { ACCOUNT_ROLES } from "../constants/roles.js";
import { isRunningDevice } from "../constants/enrollmentModes.js";
import { Device } from "../models/Device.js";
import { UnlockRequest } from "../models/UnlockRequest.js";
import { RiskFlag } from "../models/RiskFlag.js";
import { runningModeError } from "../services/runningDevicePolicy.service.js";
import { sendError } from "../utils/apiResponse.js";

const ownerOnly = (resolveDevice) => async (req, res, next) => {
  try {
    const device = await resolveDevice(req);
    if (isRunningDevice(device)) {
      const error = runningModeError();
      return sendError(res, error.statusCode, error.message, { code: error.code });
    }
    return next();
  } catch (error) {
    return sendError(res, 500, error.message || "Internal server error");
  }
};

export const ownerOnlyDealerDevice = ownerOnly(async (req) => {
  if (req.auth.role !== ACCOUNT_ROLES.TENANT_ADMIN || !req.auth.tenantId ||
    !mongoose.isValidObjectId(req.params.id)) return null;
  return Device.findOne({ _id: req.params.id, tenantId: req.auth.tenantId }).lean();
});

export const ownerOnlyAdminDevice = ownerOnly(async (req) => {
  if (!mongoose.isValidObjectId(req.params.deviceId)) return null;
  return Device.findById(req.params.deviceId).lean();
});

export const ownerOnlyDealerCase = ownerOnly(async (req) => {
  if (req.auth.role !== ACCOUNT_ROLES.TENANT_ADMIN || !req.auth.tenantId) return null;
  const unlockRequest = await UnlockRequest.findOne({ caseId: req.params.caseId, tenantId: req.auth.tenantId }).lean();
  return unlockRequest?.deviceId ? Device.findById(unlockRequest.deviceId).lean() : null;
});

export const ownerOnlyAdminCase = ownerOnly(async (req) => {
  const unlockRequest = await UnlockRequest.findOne({ caseId: req.params.caseId }).lean();
  return unlockRequest?.deviceId ? Device.findById(unlockRequest.deviceId).lean() : null;
});

export const ownerOnlyRiskFlag = ownerOnly(async (req) => {
  if (!mongoose.isValidObjectId(req.params.flagId)) return null;
  const riskFlag = await RiskFlag.findById(req.params.flagId).lean();
  return riskFlag?.deviceId ? Device.findById(riskFlag.deviceId).lean() : null;
});
