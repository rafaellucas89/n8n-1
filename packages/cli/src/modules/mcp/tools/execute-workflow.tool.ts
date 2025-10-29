import type { ExecutionRepository, IExecutionResponse, User } from '@n8n/db';
import { UserError } from 'n8n-workflow';
import type { IDataObject, IRun } from 'n8n-workflow';
import z from 'zod';

import type { ActiveExecutions } from '@/active-executions';
import { ExecutionNotFoundError } from '@/errors/execution-not-found-error';
import type { TestWebhooks } from '@/webhooks/test-webhooks';
import type { WorkflowExecutionService } from '@/workflows/workflow-execution.service';
import type { WorkflowFinderService } from '@/workflows/workflow-finder.service';
import type { WorkflowRequest } from '@/workflows/workflow.request';

import type { ToolDefinition } from '../mcp.types';
import { isManuallyExecutable } from './utils/manual-execution.utils';

// TODO: Move to constants
const MANUAL_EXECUTION_ERROR_MESSAGE =
	'This workflow requires waiting for an external trigger (for example a webhook) before it can run. Manual execution via MCP is not possible.';

const workflowInputs = {
	chatInput: z.string().optional().describe('Input for chat-based workflows'),
	formData: z.object({}).optional().describe('Input data for form-based workflows'),
	webhookData: z.object({}).optional().describe('Input data for webhook-based workflows'),
} satisfies z.ZodRawShape;

const inputSchema = {
	workflowId: z.string().describe('The ID of the workflow to execute'),
	inputs: z.object(workflowInputs).optional().describe('Inputs to provide to the workflow'),
} satisfies z.ZodRawShape;

const outputSchema = {
	success: z.boolean(),
	executionId: z.string().nullable().optional(),
	waitingForWebhook: z.boolean().optional(),
	message: z.string().optional(),
	result: z
		.object({
			id: z.string().optional(),
			status: z.string(),
			finished: z.boolean(),
			mode: z.string(),
			startedAt: z.string(),
			stoppedAt: z.string().nullable(),
			waitTill: z.string().nullable(),
			data: z.unknown(),
			error: z.unknown().nullable().optional(),
		})
		.nullable()
		.optional(),
	error: z.unknown().optional(),
} satisfies z.ZodRawShape;

// TODO: Add telemetry
export const createExecuteWorkflowTool = (
	user: User,
	workflowFinderService: WorkflowFinderService,
	workflowExecutionService: WorkflowExecutionService,
	testWebhooks: TestWebhooks,
	activeExecutions: ActiveExecutions,
	executionRepository: ExecutionRepository,
): ToolDefinition<typeof inputSchema> => ({
	name: 'execute_workflow',
	config: {
		description: 'Execute a workflow by id',
		inputSchema,
		outputSchema,
	},
	// TODO: Refactor
	// eslint-disable-next-line complexity
	handler: async ({ workflowId, inputs }) => {
		const workflow = await workflowFinderService.findWorkflowForUser(workflowId, user, [
			'workflow:read',
		]);

		if (!workflow || workflow.isArchived || !workflow.settings?.availableInMCP) {
			throw new UserError('Workflow not found');
		}

		// TODO: Remove this and use trigger-based detection
		const canManuallyExecute = await isManuallyExecutable({ user, workflow, testWebhooks });

		const manualRunPayload: WorkflowRequest.ManualRunPayload = {
			workflowData: workflow,
		};

		if (!canManuallyExecute) {
			const chatTriggerNode = workflow.nodes.find(
				(node) => !node.disabled && node.type === '@n8n/n8n-nodes-langchain.chatTrigger',
			);
			const formTriggerNode = workflow.nodes.find(
				(node) => !node.disabled && node.type === 'n8n-nodes-base.formTrigger',
			);
			const webhookNode = workflow.nodes.find(
				(node) => !node.disabled && node.type === 'n8n-nodes-base.webhook',
			);

			const triggerNode = chatTriggerNode ?? formTriggerNode ?? webhookNode;

			// TODO: Use inputs
			if (triggerNode) {
				let triggerData: IDataObject = {};

				if (chatTriggerNode) {
					triggerData = {
						sessionId: `mcp-session-${Date.now()}`,
						action: 'sendMessage',
						chatInput: inputs.chatInput,
					};
				} else if (formTriggerNode) {
					triggerData = {
						submittedAt: new Date().toISOString(),
						formMode: 'test',
					};
				} else {
					triggerData = {
						headers: {},
						params: {},
						query: {},
						body: {},
					};
				}

				// Use triggerToStartFrom to bypass webhook wait
				manualRunPayload.triggerToStartFrom = {
					name: triggerNode.name,
					data: {
						startTime: Date.now(),
						executionTime: 0,
						executionIndex: 0,
						source: [],
						data: {
							main: [
								[
									{
										json: triggerData,
									},
								],
							],
						},
					},
				};
			}
		}

		const executionResponse = await workflowExecutionService.executeManually(
			manualRunPayload,
			user,
			undefined,
		);

		// This should not happen with current implementation, but leaving it to handle possible edge-cases
		if (executionResponse.waitingForWebhook) {
			const payload = {
				success: false,
				executionId: executionResponse.executionId ?? null,
				waitingForWebhook: true,
				message: MANUAL_EXECUTION_ERROR_MESSAGE,
			};

			return {
				content: [{ type: 'text', text: JSON.stringify(payload) }],
				structuredContent: payload,
			};
		}

		const executionId = executionResponse.executionId ?? null;

		if (!executionId) {
			const payload = {
				success: false,
				executionId: null,
				message: 'Failed to start execution: no execution ID returned.',
			};

			return {
				content: [{ type: 'text', text: JSON.stringify(payload) }],
				structuredContent: payload,
			};
		}

		let executionResult: ReturnType<typeof serializeExecution>;
		try {
			executionResult = serializeExecution(
				await waitForExecutionResult(executionId, activeExecutions, executionRepository),
			);
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: 'Failed while waiting for manual execution to finish.';

			const payload = {
				success: false,
				executionId,
				message,
				error: serializeError(error),
			};

			return {
				content: [{ type: 'text', text: JSON.stringify(payload) }],
				structuredContent: payload,
			};
		}

		// TODO: Derive this from outputSchema
		const payload: {
			success: boolean;
			executionId: string;
			result: ReturnType<typeof serializeExecution>;
			error?: unknown;
			message?: string;
		} = {
			success: executionResult?.status !== 'error',
			executionId,
			result: executionResult,
			error: executionResult?.error ?? undefined,
		};

		if (!executionResult) {
			payload.success = false;
			Object.assign(payload, {
				message: 'Execution finished but result could not be retrieved.',
			});
		}

		if (executionResult?.error && typeof executionResult.error === 'object') {
			const errorWithMessage = executionResult.error as { message?: string };
			payload.message = errorWithMessage.message ?? 'Execution finished with an error.';
		}

		return {
			content: [{ type: 'text', text: JSON.stringify(payload) }],
			structuredContent: payload,
		};
	},
});

// Helper functions
const toIsoString = (value?: Date | string | null): string | null => {
	if (!value) return null;
	if (value instanceof Date) return value.toISOString();
	return new Date(value).toISOString();
};

const serializeError = (error: unknown) => {
	if (error instanceof Error) {
		return {
			name: error.name,
			message: error.message,
			stack: error.stack,
		};
	}
	return error;
};

const serializeExecution = (
	execution: IRun | IExecutionResponse | null,
): {
	id?: string;
	status: string;
	finished: boolean;
	mode: string;
	startedAt: string;
	stoppedAt: string | null;
	waitTill: string | null;
	data: unknown;
	error: unknown;
} | null => {
	if (!execution) return null;

	const toFinished = (): boolean => {
		if ('finished' in execution && execution.finished !== undefined) {
			return execution.finished;
		}
		return execution.status === 'success';
	};

	const error = execution.data?.resultData?.error ?? null;

	return {
		id: 'id' in execution ? execution.id : undefined,
		status: execution.status,
		finished: toFinished(),
		mode: execution.mode,
		startedAt: toIsoString(execution.startedAt) ?? new Date().toISOString(),
		stoppedAt: toIsoString(execution.stoppedAt ?? null),
		waitTill: toIsoString(execution.waitTill ?? null),
		data: execution.data,
		error,
	};
};

const waitForExecutionResult = async (
	executionId: string,
	activeExecutions: ActiveExecutions,
	executionRepository: ExecutionRepository,
): Promise<IRun | IExecutionResponse | null> => {
	try {
		return (await activeExecutions.getPostExecutePromise(executionId)) ?? null;
	} catch (error) {
		if (error instanceof ExecutionNotFoundError) {
			const execution = await executionRepository.findSingleExecution(executionId, {
				includeData: true,
				unflattenData: true,
			});
			return execution ?? null;
		}
		throw error;
	}
};
