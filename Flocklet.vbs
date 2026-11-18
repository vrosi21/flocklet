' Double-click to start Flocklet without a console window.
' Uses Flocklet.exe (made by "npm run brand"), falls back to plain electron.exe.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
here = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = here
exe = here & "\node_modules\electron\dist\Flocklet.exe"
If Not fso.FileExists(exe) Then exe = here & "\node_modules\electron\dist\electron.exe"
sh.Run """" & exe & """ """ & here & """", 0, False
