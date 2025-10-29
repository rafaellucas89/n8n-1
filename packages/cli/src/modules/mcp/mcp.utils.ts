import type { AuthenticatedRequest, WorkflowEntity } from '@n8n/db';
import type { Request } from 'express';

import { isRecord, isJSONRPCRequest } from './mcp.typeguards';
import {
	CHAT_TRIGGER_NODE_TYPE,
	ERROR_TRIGGER_NODE_TYPE,
	EXECUTE_WORKFLOW_TRIGGER_NODE_TYPE,
	FORM_TRIGGER_NODE_TYPE,
	MANUAL_TRIGGER_NODE_TYPE,
	SCHEDULE_TRIGGER_NODE_TYPE,
	WEBHOOK_NODE_TYPE,
} from 'n8n-workflow';

export const getClientInfo = (req: Request | AuthenticatedRequest) => {
	let clientInfo: { name?: string; version?: string } | undefined;
	if (isJSONRPCRequest(req.body) && req.body.params?.clientInfo) {
		clientInfo = req.body.params.clientInfo;
	}
	return clientInfo;
};

/**
 * Safely extracts the tool name from a JSON-RPC request
 * @param body - The request body to extract tool name from
 * @returns The tool name if valid, 'unknown' otherwise
 */
export const getToolName = (body: unknown): string => {
	if (!isJSONRPCRequest(body)) return 'unknown';
	if (!body.params) return 'unknown';

	const { name } = body.params;
	if (typeof name === 'string') {
		return name;
	}

	return 'unknown';
};

/**
 * Safely extracts tool arguments from a JSON-RPC request
 * @param body - The request body to extract arguments from
 * @returns The arguments object if valid, empty object otherwise
 */
export const getToolArguments = (body: unknown): Record<string, unknown> => {
	if (!isJSONRPCRequest(body)) return {};
	if (!body.params) return {};

	const { arguments: args } = body.params;
	if (isRecord(args)) {
		return args;
	}

	return {};
};

/**
 * Determines if MCP access can be toggled for a given workflow.
 * Workflow is eligible if it contains at least one of these (enabled) trigger nodes:
 * - Manual trigger
 * - Schedule trigger
 * - Webhook trigger
 * - Form trigger
 * - Execute workflow trigger
 * - Chat trigger
 * - Error trigger
 * @param workflow
 */
export const isWorkflowEligibleForMCPAccess = (workflow: WorkflowEntity): boolean => {
	const triggerNodeTypes = [
		MANUAL_TRIGGER_NODE_TYPE,
		SCHEDULE_TRIGGER_NODE_TYPE,
		WEBHOOK_NODE_TYPE,
		FORM_TRIGGER_NODE_TYPE,
		EXECUTE_WORKFLOW_TRIGGER_NODE_TYPE,
		CHAT_TRIGGER_NODE_TYPE,
		ERROR_TRIGGER_NODE_TYPE,
	];
	return workflow.nodes.some(
		(node) => triggerNodeTypes.includes(node.type) && node.disabled !== true,
	);
};
