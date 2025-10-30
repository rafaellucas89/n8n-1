import type { ExecutionRepository, IExecutionResponse, User } from '@n8n/db';
import { UserError } from 'n8n-workflow';
import type { IRun, IWorkflowExecutionDataProcess } from 'n8n-workflow';
import z from 'zod';

import type { ActiveExecutions } from '@/active-executions';
import { ExecutionNotFoundError } from '@/errors/execution-not-found-error';
import type { TestWebhooks } from '@/webhooks/test-webhooks';
import type { WorkflowRunner } from '@/workflow-runner';
import type { WorkflowFinderService } from '@/workflows/workflow-finder.service';

import type { ToolDefinition } from '../mcp.types';
import { isManuallyExecutable } from './utils/manual-execution.utils';

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
	testWebhooks: TestWebhooks,
	activeExecutions: ActiveExecutions,
	executionRepository: ExecutionRepository,
	workflowRunner: WorkflowRunner,
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

		// TODO:
		// - Remove this and use trigger-based detection
		// - Support multiple triggers
		const canManuallyExecute = await isManuallyExecutable({ user, workflow, testWebhooks });

		const runData: IWorkflowExecutionDataProcess = {
			executionMode: 'manual',
			workflowData: workflow,
			userId: user.id,
		};

		// For supported webhook-based triggers (webhook, form and chat),
		// use inputs as pin data to trigger the workflow synchronously
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
				// Set the trigger node as the start node
				runData.startNodes = [{ name: triggerNode.name, sourceData: null }];
				if (chatTriggerNode) {
					runData.pinData = {
						[chatTriggerNode.name]: [
							{
								json: {
									sessionId: `mcp-session-${Date.now()}`,
									action: 'sendMessage',
									chatInput: inputs?.chatInput,
								},
							},
						],
					};
				} else if (formTriggerNode) {
					runData.pinData = {
						[formTriggerNode.name]: [
							{
								json: {
									submittedAt: new Date().toISOString(),
									formMode: 'test',
								},
							},
						],
					};
				} else {
					runData.pinData = {
						[triggerNode.name]: [
							{
								json: {
									headers: {},
									params: {},
									query: {},
									body: {},
								},
							},
						],
					};
				}
			}
		}

		const executionId = await workflowRunner.run(runData);

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
