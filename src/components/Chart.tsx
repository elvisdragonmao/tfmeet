import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart } from "echarts/charts";
import { GridComponent, TooltipComponent, LegendComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsCoreOption } from "echarts/core";
echarts.use([BarChart, LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);
export default function Chart({ option, label, height = 320 }: { option: EChartsCoreOption; label: string; height?: number }) {
	const ref = useRef<HTMLDivElement>(null);
	const chart = useRef<echarts.EChartsType | null>(null);
	useEffect(() => {
		if (!ref.current) return;
		const instance = echarts.init(ref.current);
		chart.current = instance;
		const observer = new ResizeObserver(() => instance.resize());
		observer.observe(ref.current);
		return () => {
			observer.disconnect();
			instance.dispose();
			chart.current = null;
		};
	}, []);
	useEffect(() => {
		chart.current?.setOption(
			{
				animation: !matchMedia("(prefers-reduced-motion: reduce)").matches,
				color: ["#3765e7", "#d88a31", "#1e8a78"],
				textStyle: { fontFamily: "Inter, system-ui, sans-serif", fontSize: 12, color: "#727b8e" },
				grid: { left: 52, right: 20, top: 28, bottom: 42 },
				tooltip: { trigger: "axis", backgroundColor: "#fff", borderColor: "#e4e7ed", textStyle: { color: "#263247" }, confine: true },
				...option
			},
			true
		);
	}, [option]);
	return <div ref={ref} role="img" aria-label={label} style={{ height, width: "100%" }} />;
}
