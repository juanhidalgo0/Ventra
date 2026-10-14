; Agregados al instalador de Ventra (bundle.windows.nsis.installerHooks en tauri.conf.json).
;
; Hasta la 1.0.54 el editor del instalador era "godelivery", y el instalador anotaba la carpeta
; de la app en HKCU\Software\godelivery\Ventra. Con el editor "Ventra" la anota en
; HKCU\Software\Ventra\Ventra, que en la primera actualización todavía no existe: sin esto, una
; PC instalada en otra carpeta recibiría una segunda copia en la carpeta predeterminada.
; Los datos no corren riesgo en ningún caso (viven en %APPDATA%\com.godelivery.pos).

; Instalación a mano (con ventanas) sobre una versión del editor viejo: antes de mostrar la
; primera pantalla se copia la carpeta anotada a la clave nueva. Sin esto, la pantalla
; "desinstalar antes de instalar" corría el desinstalador sin carpeta y fallaba (sin borrar nada).
; Este archivo se incluye antes de que existan MANUFACTURER y PRODUCTNAME: van escritos.
; En modo silencioso (actualizaciones automáticas) no corre: ahí actúa NSIS_HOOK_PREINSTALL.
!define MUI_CUSTOMFUNCTION_GUIINIT VentraGuiInit
Function VentraGuiInit
  Push $R8
  Push $R9
  ReadRegStr $R9 SHCTX "Software\Ventra\Ventra" ""
  ${If} $R9 == ""
    ReadRegStr $R8 SHCTX "Software\godelivery\Ventra" ""
    ${If} $R8 != ""
    ${AndIf} ${FileExists} "$R8\app.exe"
      WriteRegStr SHCTX "Software\Ventra\Ventra" "" $R8
      StrCpy $INSTDIR $R8
    ${EndIf}
  ${EndIf}
  Pop $R9
  Pop $R8
FunctionEnd

!macro NSIS_HOOK_PREINSTALL
  ; Actualización automática sin la clave nueva: se instala en la carpeta de siempre
  ${If} $UpdateMode = 1
    Push $R8
    Push $R9
    ReadRegStr $R9 SHCTX "${MANUPRODUCTKEY}" ""
    ${If} $R9 == ""
      ReadRegStr $R8 SHCTX "Software\godelivery\${PRODUCTNAME}" ""
      ${If} $R8 != ""
      ${AndIf} $R8 != $INSTDIR
      ${AndIf} ${FileExists} "$R8\${MAINBINARYNAME}.exe"
        ; SetOutPath ya creó la carpeta predeterminada: se saca si quedó vacía
        RMDir $INSTDIR
        StrCpy $INSTDIR $R8
        SetOutPath $INSTDIR
      ${EndIf}
    ${EndIf}
    Pop $R9
    Pop $R8
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; La carpeta ya quedó anotada con el editor nuevo: se borra la clave vieja
  DeleteRegKey SHCTX "Software\godelivery\${PRODUCTNAME}"
  DeleteRegKey /ifempty SHCTX "Software\godelivery"
!macroend
