"use client";

import {
  Label,
  PieChart,
  Pie,
  Cell,
  Tooltip,
} from "recharts";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { ChartConfig, ChartContainer } from "@/components/ui/chart";
import { calculatePercentage, convertFileSize } from "@/lib/utils";

const chartConfig = {
  size: {
    label: "Size",
  },
  used: {
    label: "Used",
    color: "#89ce45", // Example color for used space
  },
  available: {
    label: "Available",
    color: "#82ca9d", // Example color for available space
  },
} satisfies ChartConfig;

export const Chart = ({ used = 0 }: { used: number }) => {
  const totalSpace = 2 * 1024 * 1024 * 1024; // Assuming 2GB in bytes
  const available = totalSpace - used;
  const chartData = [
    { name: "Used", value: used, color: chartConfig.used.color },
    { name: "Available", value: available, color: chartConfig.available.color },
  ];

  return (
    <Card className="chart">
      <CardContent className="flex-1 p-0">
        <ChartContainer config={chartConfig} className="chart-container">
          <PieChart width={200} height={200}>
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={80}
              fill="#8884d8"
              paddingAngle={5}
            >
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
        </ChartContainer>
      </CardContent>
      <CardHeader className="chart-details">
        <CardTitle className="chart-title">SPACE USED</CardTitle>
        <CardDescription className="chart-description">
          {used ? convertFileSize(used) : "0GB"} / 2GB
        </CardDescription>
      </CardHeader>
    </Card>
  );
};
