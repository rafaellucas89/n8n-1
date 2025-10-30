import {
	CHAT_TRIGGER_NODE_TYPE,
	ERROR_TRIGGER_NODE_TYPE,
	EXECUTE_WORKFLOW_TRIGGER_NODE_TYPE,
	FORM_TRIGGER_NODE_TYPE,
	MANUAL_TRIGGER_NODE_TYPE,
	SCHEDULE_TRIGGER_NODE_TYPE,
	WEBHOOK_NODE_TYPE,
} from '@/constants';
import type { IWorkflowDb } from '@/Interface';
import { useTelemetry } from '@/composables/useTelemetry';

export function useMcp() {
	const telemetry = useTelemetry();

	/**
	 * Determines if MCP access can be toggled for a given workflow.
	 * Workflow is eligible if it contains at least one of these (enabled) trigger nodes:
	 * - Schedule trigger
	 * - Webhook trigger
	 * - Form trigger
	 * - Chat trigger
	 * @param workflow
	 */
	const isEligibleForMcpAccess = (workflow: IWorkflowDb) => {
		const mcpTriggerNodeTypes = [
			SCHEDULE_TRIGGER_NODE_TYPE,
			WEBHOOK_NODE_TYPE,
			FORM_TRIGGER_NODE_TYPE,
			CHAT_TRIGGER_NODE_TYPE,
		];
		return workflow.nodes.some(
			(node) => mcpTriggerNodeTypes.includes(node.type) && node.disabled !== true,
		);
	};

	const trackMcpAccessEnabledForWorkflow = (workflowId: string) => {
		telemetry.track('User gave MCP access to workflow', { workflow_id: workflowId });
	};

	const trackUserToggledMcpAccess = (enabled: boolean) => {
		telemetry.track('User toggled MCP access', { state: enabled });
	};

	return {
		isEligibleForMcpAccess,
		trackMcpAccessEnabledForWorkflow,
		trackUserToggledMcpAccess,
	};
}
