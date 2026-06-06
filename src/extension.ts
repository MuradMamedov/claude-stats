import * as vscode from 'vscode';

let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
  // Command runs when the status bar item is clicked.
  const commandId = 'statusBarDemo.showWordCount';
  context.subscriptions.push(
    vscode.commands.registerCommand(commandId, () => {
      const count = getWordCount(vscode.window.activeTextEditor?.document);
      vscode.window.showInformationMessage(`Current word count: ${count}`);
    })
  );

  // Create the status bar item. Right-aligned, high priority = further left.
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.command = commandId;
  context.subscriptions.push(statusBarItem);

  // Update on the events that can change the count.
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(updateStatusBarItem),
    vscode.workspace.onDidChangeTextDocument(updateStatusBarItem),
    vscode.window.onDidChangeTextEditorSelection(updateStatusBarItem)
  );

  updateStatusBarItem();
}

function updateStatusBarItem(): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    statusBarItem.hide();
    return;
  }
  const count = getWordCount(editor.document);
  statusBarItem.text = `$(pencil) ${count} words`;
  statusBarItem.tooltip = 'Word count of the active editor — click for details';
  statusBarItem.show();
}

function getWordCount(document: vscode.TextDocument | undefined): number {
  if (!document) {
    return 0;
  }
  const text = document.getText().trim();
  if (text.length === 0) {
    return 0;
  }
  return text.split(/\s+/).length;
}

export function deactivate() { }
