// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import delay from "delay"
import * as vscode from "vscode"
import { ClineProvider } from "./core/webview/ClineProvider"
import { Logger } from "./services/logging/Logger"
import { createHaiAPI } from "./exports"
import "./utils/path" // necessary to have access to String.prototype.toPosix
import { DIFF_VIEW_URI_SCHEME } from "./integrations/editor/DiffViewProvider"
import { InlineEditingProvider } from "./integrations/inline-editing"

/*
Built using https://github.com/microsoft/vscode-webview-ui-toolkit

Inspired by
https://github.com/microsoft/vscode-webview-ui-toolkit-samples/tree/main/default/weather-webview
https://github.com/microsoft/vscode-webview-ui-toolkit-samples/tree/main/frameworks/hello-world-react-cra

*/

let outputChannel: vscode.OutputChannel

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	outputChannel = vscode.window.createOutputChannel("HAI Build")
	context.subscriptions.push(outputChannel)

	let haiTaskList: string

	Logger.initialize(outputChannel)
	Logger.log("HAI extension activated")

	const sidebarProvider = new ClineProvider(context, outputChannel)

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(ClineProvider.sideBarId, sidebarProvider, {
			webviewOptions: { retainContextWhenHidden: true },
		}),
	)

	context.subscriptions.push(
		vscode.commands.registerCommand("hai.plusButtonClicked", async () => {
			Logger.log("Plus button Clicked")
			await sidebarProvider.clearTask()
			await sidebarProvider.postStateToWebview()
			await sidebarProvider.postMessageToWebview({
				type: "action",
				action: "chatButtonClicked",
			})
		}),
	)

	context.subscriptions.push(
		vscode.commands.registerCommand("hai.mcpButtonClicked", () => {
			sidebarProvider.postMessageToWebview({
				type: "action",
				action: "mcpButtonClicked",
			})
		}),
	)

	const openClineInNewTab = async () => {
		Logger.log("Opening HAI in new tab")
		// (this example uses webviewProvider activation event which is necessary to deserialize cached webview, but since we use retainContextWhenHidden, we don't need to use that event)
		// https://github.com/microsoft/vscode-extension-samples/blob/main/webview-sample/src/extension.ts
		const tabProvider = new ClineProvider(context, outputChannel, false)
		//const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined
		const lastCol = Math.max(...vscode.window.visibleTextEditors.map((editor) => editor.viewColumn || 0))

		// Check if there are any visible text editors, otherwise open a new group to the right
		const hasVisibleEditors = vscode.window.visibleTextEditors.length > 0
		if (!hasVisibleEditors) {
			await vscode.commands.executeCommand("workbench.action.newGroupRight")
		}
		const targetCol = hasVisibleEditors ? Math.max(lastCol + 1, 1) : vscode.ViewColumn.Two

		const panel = vscode.window.createWebviewPanel(ClineProvider.tabPanelId, "HAI Build", targetCol, {
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [context.extensionUri],
		})
		// TODO: use better svg icon with light and dark variants (see https://stackoverflow.com/questions/58365687/vscode-extension-iconpath)
		// TODO: Replace with proper light and dark icons
		panel.iconPath = {
			light: vscode.Uri.joinPath(context.extensionUri, "assets", "icons", "hai-logo-mini.png"),
			dark: vscode.Uri.joinPath(context.extensionUri, "assets", "icons", "hai-logo-mini.png"),
		}
		tabProvider.resolveWebviewView(panel)

		// Lock the editor group so clicking on files doesn't open them over the panel
		await delay(100)
		await vscode.commands.executeCommand("workbench.action.lockEditorGroup")
	}

	context.subscriptions.push(vscode.commands.registerCommand("hai.popoutButtonClicked", openClineInNewTab))
	context.subscriptions.push(vscode.commands.registerCommand("hai.openInNewTab", openClineInNewTab))

	context.subscriptions.push(
		vscode.commands.registerCommand("hai.settingsButtonClicked", () => {
			//vscode.window.showInformationMessage(message)
			sidebarProvider.postMessageToWebview({
				type: "action",
				action: "settingsButtonClicked",
			})
		}),
	)

	context.subscriptions.push(
		vscode.commands.registerCommand("hai.historyButtonClicked", () => {
			sidebarProvider.postMessageToWebview({
				type: "action",
				action: "historyButtonClicked",
			})
		}),
	)

	context.subscriptions.push(
		vscode.commands.registerCommand("hai.accountLoginClicked", () => {
			sidebarProvider.postMessageToWebview({
				type: "action",
				action: "accountLoginClicked",
			})
		}),
	)

	context.subscriptions.push(
		vscode.commands.registerCommand("hai.expertsButtonClicked", () => {
			sidebarProvider.postMessageToWebview({
				type: "action",
				action: "expertsButtonClicked",
			})
		}),
	)

	/*
	We use the text document content provider API to show the left side for diff view by creating a virtual document for the original content. This makes it readonly so users know to edit the right side if they want to keep their changes.

	- This API allows you to create readonly documents in VSCode from arbitrary sources, and works by claiming an uri-scheme for which your provider then returns text contents. The scheme must be provided when registering a provider and cannot change afterwards.
	- Note how the provider doesn't create uris for virtual documents - its role is to provide contents given such an uri. In return, content providers are wired into the open document logic so that providers are always considered.
	https://code.visualstudio.com/api/extension-guides/virtual-documents
	*/
	const diffContentProvider = new (class implements vscode.TextDocumentContentProvider {
		provideTextDocumentContent(uri: vscode.Uri): string {
			return Buffer.from(uri.query, "base64").toString("utf-8")
		}
	})()
	context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(DIFF_VIEW_URI_SCHEME, diffContentProvider))

	// URI Handler
	const handleUri = async (uri: vscode.Uri) => {
		console.log("URI Handler called with:", {
			path: uri.path,
			query: uri.query,
			scheme: uri.scheme,
		})

		const path = uri.path
		const query = new URLSearchParams(uri.query.replace(/\+/g, "%2B"))
		const visibleProvider = ClineProvider.getVisibleInstance()
		if (!visibleProvider) {
			return
		}
		switch (path) {
			case "/openrouter": {
				const code = query.get("code")
				if (code) {
					await visibleProvider.handleOpenRouterCallback(code)
				}
				break
			}
			case "/auth": {
				const token = query.get("token")
				const state = query.get("state")

				console.log("Auth callback received:", {
					token: token,
					state: state,
				})

				// Validate state parameter
				if (!(await visibleProvider.validateAuthState(state))) {
					vscode.window.showErrorMessage("Invalid auth state")
					return
				}

				if (token) {
					await visibleProvider.handleAuthCallback(token)
				}
				break
			}
			default:
				break
		}
	}
	context.subscriptions.push(vscode.window.registerUriHandler({ handleUri }))

	sidebarProvider.getState().then(({ apiConfiguration }) => {
		context.subscriptions.push(
			...new InlineEditingProvider().withContext(context).withApiConfiguration(apiConfiguration).build(),
		)
	})

	context.subscriptions.push(
		vscode.commands.registerCommand("hai.haiBuildTaskListClicked", async () => {
			await sidebarProvider.postMessageToWebview({ type: "action", action: "haiBuildTaskListClicked" })

			const haiConfig = (await context.workspaceState.get("haiConfig")) || {}
			await sidebarProvider.postMessageToWebview({ type: "haiConfig", haiConfig })
		}),
	)

	return createHaiAPI(outputChannel, sidebarProvider)
}

// This method is called when your extension is deactivated
export function deactivate() {
	Logger.log("HAI extension deactivated")
}
