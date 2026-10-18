Option Explicit
Dim fso, root, sh, command
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("WScript.Shell")
command = Chr(34) & root & "\runtime\node.exe" & Chr(34) & " " & Chr(34) & root & "\src\desktop\bootstrap.cjs" & Chr(34) & " --role far"
sh.Run command, 0, False
