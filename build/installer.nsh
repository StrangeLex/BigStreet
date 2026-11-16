; Désinstallation : on retire ce que le launcher a posé dans le registre — son
; entrée de démarrage avec Windows et sa préférence de carte graphique. Pas lors
; d'une mise à jour (l'ancienne version est désinstallée puis la nouvelle reposée).
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Big Street"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "Big Street"
    DeleteRegValue HKCU "Software\Microsoft\DirectX\UserGpuPreferences" "$INSTDIR\Big Street.exe"
  ${endIf}
!macroend
