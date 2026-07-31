import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";

import "./App.css";
import { AuthProvider } from "./auth";
import "./components/components.css";
import { createExpenseFlowQueryClient } from "./query/queryClient";
import { ExpenseFlowRouter } from "./router";

const queryClient = createExpenseFlowQueryClient();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
        <QueryClientProvider client={queryClient}>
            <AuthProvider clearCache={() => queryClient.clear()}>
                <ExpenseFlowRouter />
            </AuthProvider>
        </QueryClientProvider>
    </React.StrictMode>,
);
