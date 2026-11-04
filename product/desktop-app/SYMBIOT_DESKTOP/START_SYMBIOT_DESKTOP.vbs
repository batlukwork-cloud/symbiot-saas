Option Explicit

Dim shell, fileSystem, scriptDirectory, launcherPath, commandProcessor, commandLine
Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")

scriptDirectory = fileSystem.GetParentFolderName(WScript.ScriptFullName)
launcherPath = fileSystem.BuildPath(scriptDirectory, "START_SYMBIOT_DESKTOP.cmd")

If Not fileSystem.FileExists(launcherPath) Then
  MsgBox "Не найден файл запуска Симбиота: " & launcherPath, 16, "Симбиот"
  WScript.Quit 1
End If

commandProcessor = shell.ExpandEnvironmentStrings("%ComSpec%")
commandLine = Chr(34) & commandProcessor & Chr(34) & " /d /c " & Chr(34) & Chr(34) & launcherPath & Chr(34) & Chr(34)
shell.Run commandLine, 0, False
