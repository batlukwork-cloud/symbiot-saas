const assert = require("assert");
const {
  DISPATCHER_MISSION_STATES,
  createIsolatedDispatcherContract,
  evaluateIsolatedDispatcherExecution
} = require("./symbiot-connector-service/symbiot-runtime-core");

const prepared = createIsolatedDispatcherContract({
  missionId: "MIS-SYM-20260928-ABC123",
  missionText: "Провести аудит архитектуры диспетчерской, подготовить MCC, план и бюджет для утверждения человеком."
});

assert.strictEqual(prepared.ok, true, "contract must be created");
assert.strictEqual(prepared.status, DISPATCHER_MISSION_STATES.HUMAN_APPROVAL, "mission must wait for human approval");
assert.strictEqual(prepared.contract.workspacePolicy.vaultAccess, "none", "isolated contract must not read the vault");
assert.strictEqual(prepared.contract.workspacePolicy.executionAllowed, false, "execution must be blocked before approval");
assert.deepStrictEqual(prepared.contract.workspacePolicy.readRoots, ["Настройка диспетчерской"], "read scope must stay isolated");
assert.ok(prepared.contract.plan.steps.length >= 7, "standard plan must be present");
assert.ok(prepared.contract.budget.hardLimitUsd > prepared.contract.budget.plannedUsd, "budget gate must be configured");
assert.strictEqual(prepared.contract.budget.status, "PRELIMINARY_UNVERIFIED", "budget must not pretend to be a provider invoice");
assert.strictEqual(prepared.contract.budget.breakdown.length, 4, "budget must expose auditable line items");
assert.strictEqual(
  Number(prepared.contract.budget.breakdown.reduce((sum, item) => sum + item.estimatedUsd, 0).toFixed(2)),
  prepared.contract.budget.plannedUsd,
  "budget line items must add up to the planned estimate"
);

const blocked = evaluateIsolatedDispatcherExecution(prepared.contract, { approved: false });
assert.strictEqual(blocked.ok, false, "execution must remain blocked without approval");
assert.strictEqual(blocked.reason, "HUMAN_APPROVAL_REQUIRED", "block reason must be explicit");
assert.strictEqual(blocked.modelCallsAllowed, false, "LLM calls must be blocked without approval");

const approved = evaluateIsolatedDispatcherExecution(prepared.contract, { approved: true });
assert.strictEqual(approved.ok, true, "approved contract may be handed to Hermes");
assert.strictEqual(approved.state, DISPATCHER_MISSION_STATES.READY_FOR_HERMES, "approved contract must not self-execute");
assert.strictEqual(approved.externalActionsAllowed, false, "external actions remain separately gated");

console.log(JSON.stringify({
  status: "PASS_ISOLATED_DISPATCHER_RUNTIME",
  missionId: prepared.contract.missionId,
  waitingState: prepared.contract.state,
  blockedReason: blocked.reason,
  approvedState: approved.state,
  missionType: prepared.contract.missionType.id,
  executionMode: prepared.contract.executionMode.id
}, null, 2));
