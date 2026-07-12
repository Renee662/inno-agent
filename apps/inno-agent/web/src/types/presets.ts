export interface PresetMeta {
	id: string;
	name: string;
	description: string;
	icon?: string;
	category?: string;
	quickActions?: PresetQuickAction[];
}

export interface PresetQuickAction {
	label: string;
	prompt: string;
	icon?: string;
}
