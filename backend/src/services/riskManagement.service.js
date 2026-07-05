import { AUDIT_EVENTS } from "../constants/auditEvents.js";
import { DEVICE_POLICY_KEYS, DEVICE_STATES } from "../constants/deviceStates.js";
import { AuditLog } from "../models/AuditLog.js";
import { Device } from "../models/Device.js";
import { DeviceCommand } from "../models/DeviceCommand.js";
import { DevicePolicy } from "../models/DevicePolicy.js";
import { IntegrityCheck } from "../models/IntegrityCheck.js";
import { INACTIVE_RISK_FLAG_STATUSES, RISK_FLAG_STATUSES, RiskFlag } from "../models/RiskFlag.js";
import { TenantPolicy } from "../models/TenantPolicy.js";

export const ACTIVE_RISK_FILTER = Object.freeze({
  status: { $nin: INACTIVE_RISK_FLAG_STATUSES }
});

export const DEFAULT_RISK_AUTO_LOCK_TYPES = [
  // Confirmed/permanent device compromise.
  "ROOT_DETECTED",
  "TAMPER_DETECTED",
  "SYSTEM_TAMPER_DETECTED",
  "CUSTOM_ROM_DETECTED",
  "BOOTLOADER_UNLOCKED",
  "DEVICE_INTEGRITY_COMPROMISED",
  // Critical app compromise. Protocol/config mismatch and warning-only settings
  // are intentionally excluded from default auto-lock.
  "APP_INTEGRITY_COMPROMISED",
  "APP_TAMPER_DETECTED"
];

const AUTO_RESOLVABLE_RISK_TYPES = new Set([
  "PLAY_INTEGRITY_TOKEN_EXPIRED",
  "PLAY_INTEGRITY_VERIFICATION_UNAVAILABLE",
  "USB_DEBUGGING_ENABLED",
  "DEVELOPER_OPTIONS_ENABLED",
  "UNKNOWN_SOURCES_ENABLED"
]);

const AUTO_RESOLVABLE_RISK_BUCKETS = new Set(["stale_integrity", "remediable_setting"]);

const SEVERITY_RANK = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
};

const SECURITY_STATE_RANK = {
  HEALTHY: 1,
  WARNING: 2,
  REMEDIATION: 3,
  LOCKED: 4,
  COMPROMISED_PERMANENT: 5,
  WIPED_PENDING_REPROVISION: 6
};

const CHECK_TYPE_BY_ACTION = {
  ONBOARDING_PRE_REGISTRATION: "onboarding",
  APP_STARTUP: "app_start",
  DAILY_HEARTBEAT: "periodic",
  BEFORE_POLICY_SYNC: "pre_critical_action",
  BEFORE_UNLOCK: "pre_critical_action",
  SUSPICIOUS_SIGNAL: "on_demand",
  ADMIN_RECHECK: "on_demand",
  APP_FOREGROUND: "foreground",
  BOOT_COMPLETED: "boot",
  REMEDIATION_RECHECK: "on_demand"
};

const createAuditLog = async (payload, options = {}) => {
  return AuditLog.create([payload], { ordered: true, ...options }).then((items) => items[0]);
};

const compactObject = (value = {}) =>
  Object.entries(value).reduce((result, [key, item]) => {
    if (item === undefined || item === null || item === "") return result;
    result[key] = item;
    return result;
  }, {});

const pickHigherSeverity = (current, next) => {
  return SEVERITY_RANK[next] > SEVERITY_RANK[current] ? next : current;
};

const getRiskStatusForFinding = (finding) => {
  if (finding.status) return finding.status;
  if (finding.severity === "critical" && finding.riskBucket === "device_compromise") {
    return RISK_FLAG_STATUSES.COMPROMISED_PERMANENT;
  }
  if (finding.severity === "critical" || finding.riskBucket === "app_compromise") {
    return RISK_FLAG_STATUSES.REMEDIATION_REQUIRED;
  }
  if (finding.riskBucket === "remediable_setting") {
    return RISK_FLAG_STATUSES.WARNING_PENDING;
  }
  return RISK_FLAG_STATUSES.OPEN;
};

const getSecurityStateForFindings = (findings = []) => {
  if (!findings.length) return "HEALTHY";
  if (findings.some((finding) => finding.status === RISK_FLAG_STATUSES.COMPROMISED_PERMANENT)) {
    return "COMPROMISED_PERMANENT";
  }
  if (findings.some((finding) => finding.severity === "critical")) return "REMEDIATION";
  if (findings.some((finding) => finding.severity === "high")) return "WARNING";
  return "WARNING";
};

const mergeSecurityState = (current, next) => {
  return SECURITY_STATE_RANK[next] > SECURITY_STATE_RANK[current] ? next : current;
};

const buildRiskMessage = (riskType) => {
  const messages = {
    ROOT_DETECTED: "Root indicators were reported during integrity verification",
    TAMPER_DETECTED: "Device tamper indicators were reported during integrity verification",
    SYSTEM_TAMPER_DETECTED: "System tamper indicators were reported during integrity verification",
    CUSTOM_ROM_DETECTED: "Device integrity failed and may indicate custom ROM usage",
    BOOTLOADER_UNLOCKED: "Bootloader or OS trust signal failed integrity checks",
    DEVICE_INTEGRITY_COMPROMISED: "Play Integrity device verdict failed",
    APP_INTEGRITY_COMPROMISED: "Play Integrity app verdict failed",
    APP_SIGNATURE_MISMATCH: "App package or signature did not match the trusted identity",
    DEBUGGABLE_BUILD_DETECTED: "Debuggable app build was reported on a borrower device",
    APP_TAMPER_DETECTED: "App tamper or hooking indicators were reported",
    PLAY_INTEGRITY_REQUEST_HASH_MISMATCH: "Play Integrity request hash mismatch detected",
    PLAY_INTEGRITY_TOKEN_EXPIRED: "Play Integrity token was stale or expired",
    PLAY_INTEGRITY_PACKAGE_MISMATCH: "Play Integrity package name mismatch detected",
    USB_DEBUGGING_ENABLED: "USB debugging is enabled on the borrower device",
    DEVELOPER_OPTIONS_ENABLED: "Developer options are enabled on the borrower device",
    UNKNOWN_SOURCES_ENABLED: "Install from unknown sources is enabled on the borrower device",
    PLAY_INTEGRITY_VERIFICATION_UNAVAILABLE: "Play Integrity verification was temporarily unavailable"
  };

  return messages[riskType] || `Security risk detected: ${riskType}`;
};

const addFinding = (findings, finding) => {
  const existing = findings.get(finding.riskType);
  const normalized = {
    ...finding,
    type: finding.riskType,
    message: finding.message || buildRiskMessage(finding.riskType),
    status: getRiskStatusForFinding(finding)
  };

  if (!existing) {
    findings.set(finding.riskType, normalized);
    return;
  }

  findings.set(finding.riskType, {
    ...existing,
    ...normalized,
    severity: pickHigherSeverity(existing.severity, normalized.severity),
    evidence: {
      ...(existing.evidence || {}),
      ...(normalized.evidence || {})
    }
  });
};

const mapDecisionToFindings = ({ finalDecision = {}, summary = {} }) => {
  const findings = new Map();
  const reasonCode = finalDecision.reasonCode;

  if (!reasonCode) return findings;

  if (reasonCode === "REQUEST_HASH_MISMATCH") {
    addFinding(findings, {
      riskType: "PLAY_INTEGRITY_REQUEST_HASH_MISMATCH",
      severity: "high",
      riskBucket: "protocol_mismatch",
      remediationMethod: "retry_fresh_challenge",
      status: RISK_FLAG_STATUSES.REMEDIATION_REQUIRED,
      source: "server_verified_play_integrity"
    });
  }

  if (reasonCode === "PACKAGE_NAME_MISMATCH") {
    addFinding(findings, {
      riskType: "PLAY_INTEGRITY_PACKAGE_MISMATCH",
      severity: "critical",
      riskBucket: "protocol_mismatch",
      remediationMethod: "reinstall",
      status: RISK_FLAG_STATUSES.REMEDIATION_REQUIRED,
      source: "server_verified_play_integrity"
    });
  }

  if (reasonCode === "TOKEN_TIMESTAMP_INVALID" || reasonCode === "CHALLENGE_EXPIRED") {
    addFinding(findings, {
      riskType: "PLAY_INTEGRITY_TOKEN_EXPIRED",
      severity: "medium",
      riskBucket: "stale_integrity",
      remediationMethod: "retry_fresh_challenge",
      status: RISK_FLAG_STATUSES.WARNING_PENDING,
      source: "server_verified_play_integrity"
    });
  }

  if (reasonCode === "APP_INTEGRITY_UNRECOGNIZED") {
    addFinding(findings, {
      riskType: "APP_INTEGRITY_COMPROMISED",
      severity: "critical",
      riskBucket: "app_compromise",
      remediationMethod: "reinstall",
      status: RISK_FLAG_STATUSES.REMEDIATION_REQUIRED,
      source: "server_verified_play_integrity",
      evidence: { appIntegrity: summary.appIntegrity }
    });
  }

  if (reasonCode === "DEVICE_INTEGRITY_FAILED") {
    addFinding(findings, {
      riskType: "DEVICE_INTEGRITY_COMPROMISED",
      severity: "critical",
      riskBucket: "device_compromise",
      remediationMethod: "physical_recovery",
      status: RISK_FLAG_STATUSES.COMPROMISED_PERMANENT,
      source: "server_verified_play_integrity",
      evidence: { deviceIntegrity: summary.deviceIntegrity }
    });
  }

  if (reasonCode === "PLAY_INTEGRITY_VERIFICATION_UNAVAILABLE") {
    addFinding(findings, {
      riskType: "PLAY_INTEGRITY_VERIFICATION_UNAVAILABLE",
      severity: "medium",
      riskBucket: "stale_integrity",
      remediationMethod: "retry_fresh_challenge",
      status: RISK_FLAG_STATUSES.WARNING_PENDING,
      source: "server_verified_play_integrity"
    });
  }

  return findings;
};

const mapLocalSignalsToFindings = ({ localSignals = {} }) => {
  const findings = new Map();
  const rootIndicators = Array.isArray(localSignals.rootIndicators) ? localSignals.rootIndicators : [];
  const hookingIndicators = Array.isArray(localSignals.hookingIndicators) ? localSignals.hookingIndicators : [];

  if (localSignals.isRooted || rootIndicators.length) {
    addFinding(findings, {
      riskType: "ROOT_DETECTED",
      severity: "critical",
      riskBucket: "device_compromise",
      remediationMethod: "physical_recovery",
      status: RISK_FLAG_STATUSES.COMPROMISED_PERMANENT,
      source: "server_evaluated_local_signal",
      evidence: { rootIndicators }
    });
  }

  if (localSignals.isTampered) {
    addFinding(findings, {
      riskType: "TAMPER_DETECTED",
      severity: "critical",
      riskBucket: "device_compromise",
      remediationMethod: "physical_recovery",
      status: RISK_FLAG_STATUSES.COMPROMISED_PERMANENT,
      source: "server_evaluated_local_signal"
    });
  }

  if (localSignals.debuggable) {
    addFinding(findings, {
      riskType: "DEBUGGABLE_BUILD_DETECTED",
      severity: "high",
      riskBucket: "app_compromise",
      remediationMethod: "app_update",
      status: RISK_FLAG_STATUSES.REMEDIATION_REQUIRED,
      source: "server_evaluated_local_signal"
    });
  }

  if (hookingIndicators.length) {
    addFinding(findings, {
      riskType: "APP_TAMPER_DETECTED",
      severity: "critical",
      riskBucket: "app_compromise",
      remediationMethod: "reinstall",
      status: RISK_FLAG_STATUSES.REMEDIATION_REQUIRED,
      source: "server_evaluated_local_signal",
      evidence: { hookingIndicators }
    });
  }

  if (localSignals.usbDebuggingEnabled || localSignals.adbEnabled) {
    addFinding(findings, {
      riskType: "USB_DEBUGGING_ENABLED",
      severity: "medium",
      riskBucket: "remediable_setting",
      remediationMethod: "user_fix",
      status: RISK_FLAG_STATUSES.WARNING_PENDING,
      source: "server_evaluated_local_signal"
    });
  }

  if (localSignals.developerOptionsEnabled) {
    addFinding(findings, {
      riskType: "DEVELOPER_OPTIONS_ENABLED",
      severity: "medium",
      riskBucket: "remediable_setting",
      remediationMethod: "user_fix",
      status: RISK_FLAG_STATUSES.WARNING_PENDING,
      source: "server_evaluated_local_signal"
    });
  }

  if (localSignals.unknownSourcesEnabled || localSignals.installFromUnknownSourcesEnabled) {
    addFinding(findings, {
      riskType: "UNKNOWN_SOURCES_ENABLED",
      severity: "medium",
      riskBucket: "remediable_setting",
      remediationMethod: "user_fix",
      status: RISK_FLAG_STATUSES.WARNING_PENDING,
      source: "server_evaluated_local_signal"
    });
  }

  return findings;
};

export const buildRiskFindingsFromIntegrity = ({ finalDecision, summary, localSignals }) => {
  const findings = mapDecisionToFindings({ finalDecision, summary });
  const localFindings = mapLocalSignalsToFindings({ localSignals });

  for (const finding of localFindings.values()) {
    addFinding(findings, finding);
  }

  return Array.from(findings.values());
};

const getIntegrityCheckResult = ({ finalDecision = {}, findings = [], providerError }) => {
  if (providerError) return "error";
  if (finalDecision.reasonCode === "TOKEN_TIMESTAMP_INVALID" || finalDecision.reasonCode === "CHALLENGE_EXPIRED") return "stale";
  if (findings.length) return "risk_found";
  if (finalDecision.decision === "allow") return "clean";
  return "invalid";
};

const isAutoResolvableRiskFlag = (riskFlag) => {
  if (!riskFlag || riskFlag.severity === "critical") return false;
  if ([RISK_FLAG_STATUSES.COMPROMISED_PERMANENT, RISK_FLAG_STATUSES.WIPED_PENDING_REPROVISION].includes(riskFlag.status)) {
    return false;
  }

  const riskType = riskFlag.riskType || riskFlag.type;
  if (AUTO_RESOLVABLE_RISK_TYPES.has(riskType)) return true;
  if (AUTO_RESOLVABLE_RISK_BUCKETS.has(riskFlag.riskBucket) && ["low", "medium"].includes(riskFlag.severity)) return true;
  return ["warning_only", "user_fix", "retry_fresh_challenge"].includes(riskFlag.remediationMethod) && ["low", "medium"].includes(riskFlag.severity);
};

const autoResolveRisksAfterCleanCheck = async ({ device, integrityCheck, now }) => {
  if (!device?._id) return [];

  const activeRisks = await RiskFlag.find({
    deviceId: device._id,
    ...ACTIVE_RISK_FILTER
  });
  const autoResolvableRisks = activeRisks.filter(isAutoResolvableRiskFlag);

  if (!autoResolvableRisks.length) return [];

  for (const riskFlag of autoResolvableRisks) {
    riskFlag.status = RISK_FLAG_STATUSES.RESOLVED;
    riskFlag.lastCleanCheckAt = now;
    riskFlag.clearedAt = now;
    riskFlag.clearanceReason = "Auto-resolved after clean integrity recheck";
    riskFlag.metadata = {
      ...(riskFlag.metadata || {}),
      autoResolved: true,
      autoResolvedAt: now,
      resolvedByIntegrityCheckId: integrityCheck._id
    };
    await riskFlag.save();

    await createAuditLog({
      eventType: AUDIT_EVENTS.RISK_FLAG_AUTO_RESOLVED,
      actorId: device.userId,
      actorCollection: "users",
      tenantId: riskFlag.tenantId,
      userId: riskFlag.userId,
      deviceId: riskFlag.deviceId,
      reason: "Auto-resolved after clean integrity recheck",
      metadata: {
        riskFlagId: riskFlag._id,
        riskType: riskFlag.riskType || riskFlag.type,
        integrityCheckId: integrityCheck._id
      }
    });
  }

  return autoResolvableRisks;
};

const upsertRiskFlagForFinding = async ({ finding, integrityCheck, challenge, device, localSignals, summary }) => {
  const now = new Date();
  const baseFilter = {
    type: finding.riskType,
    tenantId: challenge.tenantId,
    ...ACTIVE_RISK_FILTER
  };

  if (device?._id) {
    baseFilter.deviceId = device._id;
  } else {
    baseFilter.userId = challenge.userId;
  }

  const existing = await RiskFlag.findOne(baseFilter);
  const evidence = compactObject({
    ...(finding.evidence || {}),
    integrityCheckId: integrityCheck._id,
    deviceRecognitionVerdict: summary.deviceIntegrity,
    appIntegrityVerdict: summary.appIntegrity,
    packageName: summary.packageName,
    reasonCode: integrityCheck.reasonCode,
    localSignals
  });

  if (existing) {
    existing.riskType = finding.riskType;
    existing.severity = pickHigherSeverity(existing.severity, finding.severity);
    existing.status = finding.status;
    existing.riskBucket = finding.riskBucket;
    existing.remediationMethod = finding.remediationMethod;
    existing.source = finding.source;
    existing.message = finding.message;
    existing.evidence = evidence;
    existing.relatedIntegrityCheckId = integrityCheck._id;
    existing.lastDetectedAt = now;
    existing.metadata = {
      ...(existing.metadata || {}),
      lastIntegrityCheckId: integrityCheck._id,
      lastReasonCode: integrityCheck.reasonCode,
      repeatedDetection: true
    };
    await existing.save();
    return existing;
  }

  return RiskFlag.create({
    type: finding.riskType,
    riskType: finding.riskType,
    severity: finding.severity,
    status: finding.status,
    riskBucket: finding.riskBucket,
    remediationMethod: finding.remediationMethod,
    source: finding.source,
    tenantId: challenge.tenantId,
    deviceId: device?._id,
    userId: challenge.userId,
    message: finding.message,
    evidence,
    relatedIntegrityCheckId: integrityCheck._id,
    firstDetectedAt: now,
    lastDetectedAt: now,
    metadata: {
      integrityCheckId: integrityCheck._id,
      reasonCode: integrityCheck.reasonCode,
      checkType: integrityCheck.checkType
    }
  });
};

export const recordIntegrityAssessment = async ({
  challenge,
  device,
  summary = {},
  finalDecision = {},
  localSignals = {},
  rawVerdictSafeSnapshot = {},
  providerError
}) => {
  const findings = buildRiskFindingsFromIntegrity({ finalDecision, summary, localSignals });
  const result = getIntegrityCheckResult({ finalDecision, findings, providerError });
  const now = new Date();

  const integrityCheck = await IntegrityCheck.create({
    deviceId: device?._id,
    userId: challenge.userId,
    tenantId: challenge.tenantId,
    challengeId: challenge._id,
    checkType: CHECK_TYPE_BY_ACTION[challenge.action] || "unknown",
    triggerReason: challenge.action,
    requestHash: challenge.requestHash,
    nonce: challenge.nonce,
    tokenReceivedAt: now,
    verdictTimestampMillis: summary.timestampMillis,
    verifiedAt: now,
    packageName: summary.packageName,
    appIntegrityVerdict: summary.appIntegrity,
    deviceRecognitionVerdict: summary.deviceIntegrity || [],
    playProtectVerdict: summary.playProtectVerdict,
    appAccessRiskVerdict: summary.appAccessRiskVerdict,
    localSignals,
    decision: finalDecision.decision,
    observedDecision: finalDecision.observedDecision,
    integrityStatus: finalDecision.integrityStatus,
    reasonCode: finalDecision.reasonCode,
    result,
    rawVerdictSafeSnapshot,
    providerError
  });

  const riskFlags = [];
  for (const finding of findings) {
    const riskFlag = await upsertRiskFlagForFinding({
      finding,
      integrityCheck,
      challenge,
      device,
      localSignals,
      summary
    });
    riskFlags.push(riskFlag);
  }

  if (riskFlags.length) {
    integrityCheck.createdRiskIds = riskFlags.map((flag) => flag._id);
    await integrityCheck.save();
  }

  if (device?._id) {
    const deviceUpdate = {
      $set: {
        lastIntegrityCheckAt: now
      }
    };

    if (result === "clean") {
      deviceUpdate.$set.lastCleanIntegrityAt = now;
      deviceUpdate.$set.integrityStaleAfter = new Date(now.getTime() + 4 * 60 * 60 * 1000);
      const autoResolvedRiskFlags = await autoResolveRisksAfterCleanCheck({ device, integrityCheck, now });
      if (autoResolvedRiskFlags.length) {
        integrityCheck.resolvedRiskIds = autoResolvedRiskFlags.map((flag) => flag._id);
        await integrityCheck.save();
        deviceUpdate.$pull = {
          currentRiskIds: { $in: autoResolvedRiskFlags.map((flag) => flag._id) }
        };
      }
      const hasActiveRisk = await RiskFlag.exists({
        deviceId: device._id,
        ...ACTIVE_RISK_FILTER
      });
      if (!hasActiveRisk) {
        deviceUpdate.$set.deviceSecurityState = "HEALTHY";
      }
    } else if (riskFlags.length) {
      const nextSecurityState = getSecurityStateForFindings(findings);
      deviceUpdate.$set.lastRiskAt = now;
      deviceUpdate.$set.deviceSecurityState = mergeSecurityState(device.deviceSecurityState || "HEALTHY", nextSecurityState);
      deviceUpdate.$set.currentRiskIds = riskFlags.map((flag) => flag._id);
      if (findings.some((finding) => finding.riskType === "ROOT_DETECTED")) {
        deviceUpdate.$set.isRooted = true;
      }
      if (findings.some((finding) => ["TAMPER_DETECTED", "SYSTEM_TAMPER_DETECTED", "APP_TAMPER_DETECTED"].includes(finding.riskType))) {
        deviceUpdate.$set.isTampered = true;
      }
    }

    await Device.findByIdAndUpdate(device._id, deviceUpdate);
  }

  if (riskFlags.length) {
    await createAuditLog({
      eventType: AUDIT_EVENTS.DEVICE_SECURITY_EVENT_RECEIVED,
      actorId: challenge.userId,
      actorCollection: "users",
      tenantId: challenge.tenantId,
      userId: challenge.userId,
      deviceId: device?._id,
      reason: "Server verified integrity risk",
      metadata: {
        integrityCheckId: integrityCheck._id,
        riskFlagIds: riskFlags.map((flag) => flag._id),
        reasonCode: finalDecision.reasonCode,
        observedDecision: finalDecision.observedDecision
      }
    });
  }

  return { integrityCheck, findings, riskFlags };
};

export const enforceRiskAutoLock = async ({ device, riskFlag, eventType, severity, enforce = true }) => {
  if (!enforce) {
    return { queued: false, reason: "INTEGRITY_OBSERVE_MODE" };
  }

  const tenantPolicy = await TenantPolicy.findOne({ tenantId: device.tenantId }).lean();
  const riskRules = tenantPolicy?.riskRules || {};
  const autoLockEnabled = riskRules.autoLockOnCriticalSecurityRisk !== false;
  const autoLockTypes = riskRules.autoLockTypes?.length ? riskRules.autoLockTypes : DEFAULT_RISK_AUTO_LOCK_TYPES;

  if (!autoLockEnabled || severity !== "critical" || !autoLockTypes.includes(eventType)) {
    return { queued: false, reason: "RISK_RULE_NOT_MATCHED" };
  }

  if (device.state === DEVICE_STATES.LOCKED) {
    return { queued: false, reason: "DEVICE_ALREADY_LOCKED" };
  }

  const policy = await DevicePolicy.findOne({
    tenantId: device.tenantId,
    policyKey: DEVICE_POLICY_KEYS.EMI_LOCKED,
    isActive: true
  }).lean();

  if (!policy) {
    return { queued: false, reason: "EMI_LOCKED_POLICY_NOT_FOUND" };
  }

  const existingCommand = await DeviceCommand.findOne({
    deviceId: device._id,
    commandType: "LOCK",
    status: { $in: ["pending", "sent"] },
    "payload.source": "risk_auto_lock",
    "payload.riskFlagId": riskFlag._id.toString()
  }).lean();

  if (existingCommand) {
    return { queued: false, reason: "LOCK_COMMAND_ALREADY_EXISTS", commandId: existingCommand._id };
  }

  const lockedDevice = await Device.findOneAndUpdate(
    {
      _id: device._id,
      state: { $ne: DEVICE_STATES.LOCKED }
    },
    {
      $set: {
        state: DEVICE_STATES.LOCKED,
        currentPolicyKey: DEVICE_POLICY_KEYS.EMI_LOCKED,
        currentPolicyId: policy._id,
        stateUpdatedAt: new Date(),
        deviceSecurityState: "LOCKED"
      },
      $inc: { desiredPolicyVersion: 1 },
      $unset: { tempUnlockExpiresAt: "" }
    },
    { new: true }
  );

  if (!lockedDevice) {
    return { queued: false, reason: "DEVICE_LOCK_CONDITION_FAILED" };
  }

  const command = await DeviceCommand.create({
    deviceId: lockedDevice._id,
    tenantId: lockedDevice.tenantId,
    commandType: "LOCK",
    triggeredBy: "auto_policy",
    payload: {
      source: "risk_auto_lock",
      policyKey: DEVICE_POLICY_KEYS.EMI_LOCKED,
      policyVersion: lockedDevice.desiredPolicyVersion,
      reason: `Critical security risk: ${eventType}`,
      riskFlagId: riskFlag._id.toString(),
      riskType: eventType,
      severity
    }
  });

  await createAuditLog({
    eventType: AUDIT_EVENTS.MANUAL_LOCK_TRIGGERED,
    actorCollection: "system",
    tenantId: lockedDevice.tenantId,
    userId: lockedDevice.userId,
    deviceId: lockedDevice._id,
    reason: `Critical security risk: ${eventType}`,
    metadata: {
      source: "risk_auto_lock",
      riskFlagId: riskFlag._id,
      commandId: command._id,
      riskType: eventType,
      severity
    }
  });

  return {
    queued: true,
    commandId: command._id,
    deviceState: lockedDevice.state,
    policyKey: lockedDevice.currentPolicyKey,
    policyVersion: lockedDevice.desiredPolicyVersion
  };
};

export const getActiveRiskFilter = (extra = {}) => ({
  ...extra,
  ...ACTIVE_RISK_FILTER
});

export const getActiveCriticalRiskFlagsForDevice = (deviceId) => {
  return RiskFlag.find({
    deviceId,
    severity: "critical",
    ...ACTIVE_RISK_FILTER
  }).lean();
};
