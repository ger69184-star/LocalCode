Option Explicit
Dim sh, fso, dir, chk, cmd, logp, i, txt, ok, f, tail
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
logp = dir & "\localcode.log"
If Not fso.FileExists(dir & "\app\server.js") Then
  MsgBox "app\server.js not found in " & dir & vbCrLf & "Unpack the whole archive and run LocalCode.vbs from its folder.", 16, "LocalCode"
  WScript.Quit 1
End If
' Node.js must be available
chk = sh.Run("cmd /c where node >nul 2>nul", 0, True)
If chk <> 0 Then
  sh.Environment("PROCESS")("PATH") = sh.Environment("PROCESS")("PATH") & ";" & sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\nodejs"
  chk = sh.Run("cmd /c where node >nul 2>nul", 0, True)
  If chk <> 0 Then
    MsgBox "Node.js not found. Run install.bat first or install Node.js LTS from https://nodejs.org", 16, "LocalCode"
    WScript.Quit 1
  End If
End If
' start the server hidden; the log goes to localcode.log
On Error Resume Next
If fso.FileExists(logp) Then fso.DeleteFile logp, True
On Error GoTo 0
cmd = "cmd /c node app/server.js --app >""" & logp & """ 2>&1"
sh.Run cmd, 0, False
' wait up to ~15 s until the server reports that it is running
ok = False
For i = 1 To 25
  WScript.Sleep 600
  txt = ""
  On Error Resume Next
  If fso.FileExists(logp) Then
    Set f = fso.OpenTextFile(logp, 1, False)
    txt = f.ReadAll
    f.Close
  End If
  On Error GoTo 0
  If InStr(txt, "http://localhost") > 0 Then
    ok = True
    Exit For
  End If
  If InStr(txt, "EADDRINUSE") > 0 Or InStr(txt, "Error:") > 0 Then Exit For
Next
If Not ok Then
  tail = txt
  If Len(tail) > 500 Then tail = Right(tail, 500)
  MsgBox "LocalCode did not start." & vbCrLf & vbCrLf & "Log (localcode.log):" & vbCrLf & tail & vbCrLf & vbCrLf & "Try LocalCode.bat to see the console output.", 48, "LocalCode"
End If
