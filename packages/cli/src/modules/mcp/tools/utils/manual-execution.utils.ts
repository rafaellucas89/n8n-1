import type { User } from '@n8n/db';
import type { IWorkflowBase } from 'n8n-workflow';

import type { TestWebhooks } from '@/webhooks/test-webhooks';
import * as WorkflowExecuteAdditionalData from '@/workflow-execute-additional-data';

export async function isManuallyExecutable({
	user,
	workflow,
	testWebhooks,
}: {
	user: User;
	workflow: IWorkflowBase;
	testWebhooks: TestWebhooks;
}) {
	const additionalData = await WorkflowExecuteAdditionalData.getBase({
		userId: user.id,
		workflowId: workflow.id,
	});

	const needsWebhook = await testWebhooks.needsWebhook({
		userId: user.id,
		workflowEntity: workflow,
		additionalData,
	});

	return !needsWebhook;
}
