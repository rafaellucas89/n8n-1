<script setup lang="ts">
import { ref, computed } from 'vue';
import { N8nButton, N8nIcon, N8nOption, N8nSelect, N8nText } from '@n8n/design-system';
import Modal from '@/components/Modal.vue';
import { useCredentialsStore } from '@/features/credentials/credentials.store';
import type { ICredentialsResponse } from '@/features/credentials/credentials.types';
import { createEventBus } from '@n8n/utils/event-bus';
import { WEB_SEARCH_TOOL_CREDENTIAL_TYPE_MAP, type WebSearchTool } from '@n8n/api-types';

type ToolConfiguration = {
	nodeType: WebSearchTool;
	credentialId: string | null;
};

const props = defineProps<{
	initialValue: ToolConfiguration | null;
}>();

const emit = defineEmits<{
	select: [ToolConfiguration];
}>();

const credentialsStore = useCredentialsStore();
const modalBus = ref(createEventBus());

const selectedWebSearchTool = ref<ToolConfiguration | null>(props.initialValue);

const availableTools = computed<WebSearchTool[]>(() => {
	return Object.keys(WEB_SEARCH_TOOL_CREDENTIAL_TYPE_MAP) as WebSearchTool[];
});

const availableCredentials = computed<ICredentialsResponse[]>(() => {
	if (!selectedWebSearchTool.value) {
		return [];
	}

	const credentialType = WEB_SEARCH_TOOL_CREDENTIAL_TYPE_MAP[selectedWebSearchTool.value.nodeType];

	return credentialsStore.getCredentialsByType(credentialType);
});

function onToolSelect(nodeType: WebSearchTool) {
	selectedWebSearchTool.value = {
		nodeType,
		credentialId: null,
	};
}

function onCredentialSelect(credentialId: string) {
	if (selectedWebSearchTool.value) {
		selectedWebSearchTool.value.credentialId = credentialId;
	}
}

function onConfirm() {
	if (selectedWebSearchTool.value) {
		emit('select', selectedWebSearchTool.value);
		modalBus.value.emit('close');
	}
}

function onCancel() {
	modalBus.value.emit('close');
}

function onCreateNewCredential() {
	if (!selectedWebSearchTool.value) return;

	const credentialType = WEB_SEARCH_TOOL_CREDENTIAL_TYPE_MAP[selectedWebSearchTool.value.nodeType];
	console.log('Create new credential of type:', credentialType);

	// credentialsStore.openCreateCredentialModal(credentialType, {
	// 	onCreated: (newCredential) => {
	// 		selectedWebSearchTool.value!.credentialId = newCredential.id;
	// 	},
	// });
}
</script>

<template>
	<Modal
		name="webSearchToolsSelector"
		:event-bus="modalBus"
		width="50%"
		:center="true"
		max-width="460px"
		min-height="250px"
	>
		<template #header>
			<div :class="$style.header">
				<N8nIcon icon="globe" :size="24" :class="$style.icon" />
				<h2 :class="$style.title">Configure Web Search Tools</h2>
			</div>
		</template>
		<template #content>
			<div :class="$style.content">
				<N8nText size="small" color="text-base"> Choose Web Search Tool</N8nText>
				<N8nSelect
					:model-value="selectedWebSearchTool?.nodeType"
					size="large"
					placeholder="Select tool..."
					@update:model-value="onToolSelect"
				>
					<N8nOption v-for="tool in availableTools" :key="tool" :value="tool" :label="tool" />
				</N8nSelect>
				<N8nSelect
					v-if="selectedWebSearchTool"
					:model-value="selectedWebSearchTool.credentialId"
					size="large"
					placeholder="Select credential..."
					@update:model-value="onCredentialSelect"
				>
					<N8nOption
						v-for="credential in availableCredentials"
						:key="credential.id"
						:value="credential.id"
						:label="credential.name"
					/>
				</N8nSelect>
			</div>
		</template>
		<template #footer>
			<div :class="$style.footer">
				<N8nButton type="secondary" @click="onCreateNewCredential"> Create New </N8nButton>
				<div :class="$style.footerRight">
					<N8nButton type="tertiary" @click="onCancel"> Cancel </N8nButton>
					<N8nButton type="primary" :disabled="!selectedWebSearchTool" @click="onConfirm">
						Select
					</N8nButton>
				</div>
			</div>
		</template>
	</Modal>
</template>

<style lang="scss" module>
.title {
	font-size: var(--font-size--lg);
	line-height: var(--line-height--md);
	margin: 0;
}

.content {
	display: flex;
	flex-direction: column;
	gap: var(--spacing--sm);
	padding: var(--spacing--sm) 0;
}

.footer {
	display: flex;
	justify-content: space-between;
	align-items: center;
	width: 100%;
}

.footerRight {
	display: flex;
	gap: var(--spacing--2xs);
}

.header {
	display: flex;
	gap: var(--spacing--2xs);
	align-items: center;
}

.icon {
	flex-shrink: 0;
	flex-grow: 0;
}
</style>
