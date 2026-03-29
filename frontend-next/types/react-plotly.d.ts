declare module 'react-plotly.js' {
	import * as React from 'react';

	export type PlotParams = {
		data?: unknown[];
		layout?: Record<string, unknown>;
		config?: Record<string, unknown>;
		frames?: unknown[];
		revision?: number;
		className?: string;
		style?: React.CSSProperties;
		useResizeHandler?: boolean;
		onInitialized?: (figure: unknown, graphDiv: unknown) => void;
		onUpdate?: (figure: unknown, graphDiv: unknown) => void;
		onPurge?: (figure: unknown, graphDiv: unknown) => void;
		onError?: (err: unknown) => void;
	};

	export default class Plot extends React.Component<PlotParams> {}
}
