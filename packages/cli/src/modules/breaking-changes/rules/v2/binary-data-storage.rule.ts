import { Service } from '@n8n/di';
import { BinaryDataConfig } from 'n8n-core';

import type {
	BreakingChangeMetadata,
	InstanceDetectionResult,
	IBreakingChangeInstanceRule,
} from '../../types';
import { BreakingChangeSeverity, BreakingChangeCategory, IssueLevel } from '../../types';

@Service()
export class BinaryDataStorageRule implements IBreakingChangeInstanceRule {
	constructor(private readonly config: BinaryDataConfig) {}

	id: string = 'binary-data-storage-v2';

	getMetadata(): BreakingChangeMetadata {
		return {
			version: 'v2',
			title: 'Disable binary data in-memory mode by default',
			description:
				'Binary files are now stored on disk by default instead of in memory, removing the 512MB file size limit',
			category: BreakingChangeCategory.infrastructure,
			severity: BreakingChangeSeverity.medium,
		};
	}

	async detect(): Promise<InstanceDetectionResult> {
		if (this.config.mode !== 'default') {
			return {
				isAffected: false,
				instanceIssues: [],
				recommendations: [],
			};
		}

		const result: InstanceDetectionResult = {
			isAffected: true,
			instanceIssues: [
				{
					title: 'Binary data storage mode changed',
					description:
						'Binary files are now stored in ~/.n8n/binaryData/ directory by default instead of in memory. This removes the previous 512MB file size limit but increases disk usage.',
					level: IssueLevel.info,
				},
			],
			recommendations: [
				{
					action: 'Ensure adequate disk space',
					description:
						'Verify sufficient disk space is available for binary file storage in the ~/.n8n/binaryData/ directory',
				},
				{
					action: 'Configure persistent storage',
					description:
						'If using containers, ensure the binary data directory is mounted on a persistent volume',
				},
				{
					action: 'Include in backups',
					description: 'Add the binary data folder to your backup procedures',
				},
			],
		};

		return result;
	}
}
