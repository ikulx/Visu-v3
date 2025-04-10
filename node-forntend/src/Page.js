import React, { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import EditVariableModal from './EditVariableModal';
import socket from './socket';
import { Spin} from 'antd';

const svgCache = {}; // Einfacher In-Memory Cache

const fetchSvg = (svgFile) => {
  // Prüfen, ob die Datei bereits im Cache ist (als Promise oder als Text)
  if (svgCache[svgFile]) {
    // Wenn es ein Promise ist, warte darauf. Wenn es Text ist, gib ihn sofort zurück.
    return Promise.resolve(svgCache[svgFile]);
  }

  // Wenn nicht im Cache, starte den Fetch-Vorgang
  const promise = fetch(svgFile)
    .then(response => {
      if (!response.ok) {
        // Fehler werfen, damit das .catch greift
        throw new Error(`SVG ${svgFile} nicht gefunden (Status: ${response.status})`);
      }
      return response.text();
    })
    .then(text => {
      svgCache[svgFile] = text; // SVG-Inhalt im Cache speichern
      console.log(`SVG geladen und gecached: ${svgFile}`);
      return text;
    })
    .catch(err => {
      console.error(`Fehler beim Laden oder Cachen von SVG ${svgFile}:`, err);
      svgCache[svgFile] = null; // Markiere als fehlgeschlagen im Cache, um wiederholte Fehler zu vermeiden
      throw err; // Fehler weiterwerfen, damit die aufrufende Komponente reagieren kann
    });

  // Speichere das Promise im Cache, damit parallele Anfragen auf dasselbe Promise warten
  svgCache[svgFile] = promise;
  return promise;
};


const Page = ({ svg: currentSvg, properties, allSvgs = [] }) => {
  const { t } = useTranslation();
  const currentSvgFile = currentSvg ? `/assets/${currentSvg}.svg` : null; // Nur laden, wenn SVG vorhanden
  const [svgContent, setSvgContent] = useState('');
  const [isLoading, setIsLoading] = useState(true); // Ladezustand
  const [errorLoading, setErrorLoading] = useState(null); // Fehlerzustand
  const containerRef = useRef(null);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editRecords, setEditRecords] = useState([]);
  const [actions, setActions] = useState({}); // Aktions-Mapping speichern

   // SVG Preloading (optional)
   useEffect(() => {
     if (Array.isArray(allSvgs)) {
         allSvgs.forEach(svgName => {
            if (svgName) {
                 const svgFile = `/assets/${svgName}.svg`;
                 fetchSvg(svgFile).catch(() => {}); // Fehler ignorieren, nur Vorladen versuchen
            }
         });
     }
   }, [allSvgs]);

  // Effekt zum Laden des aktuellen SVGs
  useEffect(() => {
    if (!currentSvgFile) {
       setSvgContent(''); // Kein SVG zum Anzeigen
       setIsLoading(false);
       setErrorLoading(null);
       return;
    }

    setIsLoading(true);
    setErrorLoading(null);
    setSvgContent(''); // Vorherigen Inhalt löschen

    console.log(`[Page] Versuche SVG zu laden: ${currentSvgFile}`);

    fetchSvg(currentSvgFile)
      .then(text => {
          if (text) { // Nur setzen, wenn Text erfolgreich geladen wurde
              setSvgContent(text);
              setErrorLoading(null);
          } else {
              setErrorLoading(`SVG ${currentSvgFile} konnte nicht geladen oder war leer.`);
          }
          setIsLoading(false);
      })
      .catch(err => {
          console.error(`[Page] Fehler beim Laden von ${currentSvgFile}:`, err);
          setErrorLoading(err.message || `Fehler beim Laden von ${currentSvgFile}.`);
          setSvgContent(''); // Sicherstellen, dass kein alter Inhalt angezeigt wird
          setIsLoading(false);
      });

  }, [currentSvgFile]); // Abhängigkeit ist nur der Dateipfad


  // Effekt zum Verarbeiten des SVGs und Anwenden von Properties/Actions
  useEffect(() => {
    if (!svgContent || !containerRef.current || isLoading || errorLoading) {
      // Nicht verarbeiten, wenn SVG leer, nicht geladen, fehlerhaft oder Container nicht bereit
      if (containerRef.current) containerRef.current.innerHTML = ''; // Container leeren
      return;
    }
    console.log(`[Page] Verarbeite SVG für ${currentSvgFile} mit Properties:`, properties);

    let processedSvg = svgContent;
    try {
      // Ersetze Platzhalter {{...}} mit Übersetzungen
      processedSvg = svgContent.replace(/{{(.*?)}}/g, (match, p1) => t(p1.trim()));
    } catch(replaceError) {
        console.error("Fehler beim Ersetzen von Textplatzhaltern:", replaceError);
        // Fahre trotzdem fort mit dem ursprünglichen SVG-Inhalt
        processedSvg = svgContent;
    }


    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(processedSvg, 'image/svg+xml');

    // Fehlerbehandlung beim Parsen
    const parseError = xmlDoc.querySelector('parsererror');
    if (parseError) {
        console.error("Fehler beim Parsen des SVG:", parseError.textContent);
        setErrorLoading("Fehler beim Parsen des SVG.");
        if (containerRef.current) containerRef.current.innerHTML = ''; // Container leeren
        return;
    }


    const ycontrol = xmlDoc.querySelector('ycontrol');
    const actionMap = {}; // Lokale Map für Aktionen dieses SVGs

    if (ycontrol && properties && typeof properties === 'object') { // Sicherstellen, dass properties ein Objekt ist
        const propertyElements = ycontrol.querySelectorAll('property');
        propertyElements.forEach(propEl => {
            const propName = propEl.getAttribute('name');
            // Sicherstellen, dass properties.properties existiert
            const currentValue = properties.properties?.[propName];
            const value = currentValue !== undefined ? String(currentValue) : propEl.getAttribute('defaultvalue'); // Wert als String behandeln für Vergleiche

            const targets = propEl.querySelectorAll('target');
            targets.forEach(target => {
                const targetType = target.getAttribute('type');
                const targetElementName = target.getAttribute('element');
                if (!targetElementName) return; // Überspringen, wenn kein Element angegeben ist

                let outputValue = null;
                const conditions = target.querySelectorAll('condition');

                if (conditions.length > 0) {
                    for (const cond of conditions) {
                        if (cond.hasAttribute('eq') && cond.getAttribute('eq') === value) { outputValue = cond.getAttribute('output'); break; }
                        if (cond.hasAttribute('lt') && Number(value) < Number(cond.getAttribute('lt'))) { outputValue = cond.getAttribute('output'); break; }
                        if (cond.hasAttribute('gt') && Number(value) > Number(cond.getAttribute('gt'))) { outputValue = cond.getAttribute('output'); break; }
                        if (cond.hasAttribute('lte') && Number(value) <= Number(cond.getAttribute('lte'))) { outputValue = cond.getAttribute('output'); break; }
                        if (cond.hasAttribute('gte') && Number(value) >= Number(cond.getAttribute('gte'))) { outputValue = cond.getAttribute('output'); break; }
                         if (cond.hasAttribute('default')) { outputValue = cond.getAttribute('output'); /* Kein break, letzte Bedingung */ }
                    }
                } else {
                    outputValue = value; // Kein Condition, Wert direkt verwenden
                }

                // Wende Output nur an, wenn er nicht null ist
                if (outputValue !== null) {
                    try {
                        const elementsToUpdate = xmlDoc.querySelectorAll(`.${targetElementName}, [id="${targetElementName}"]`); // Suche nach Klasse oder ID
                        elementsToUpdate.forEach(el => {
                            if (targetType === 'Style') {
                                const selector = target.getAttribute('selector');
                                if (selector && typeof el.style === 'object') { // Prüfe ob style existiert
                                    el.style[selector] = outputValue;
                                }
                            } else if (targetType === 'Content') {
                                // Finde das tiefste Kindelement (oft tspan in Text) oder setze direkt
                                let targetElement = el;
                                while (targetElement.firstChild && targetElement.firstChild.nodeType === Node.ELEMENT_NODE) {
                                    targetElement = targetElement.firstChild;
                                }
                                targetElement.textContent = outputValue;
                            } else if (targetType === 'Visibility') {
                                el.style.display = (outputValue === 'true' || outputValue === '1') ? '' : 'none';
                            }
                        });
                    } catch (applyError) {
                         console.error(`Fehler beim Anwenden von Property "${propName}" auf Element "${targetElementName}":`, applyError);
                    }
                }
            });
        });

        // Aktionen verarbeiten
        const actionElements = ycontrol.querySelectorAll('action');
        actionElements.forEach(actionEl => {
            const actionName = actionEl.getAttribute('name');
            const trigger = actionEl.getAttribute('triggers') || 'click'; // Standardmäßig 'click'
            const elementClassOrId = actionEl.getAttribute('element');
            if (trigger === 'click' && elementClassOrId && actionName) {
                actionMap[actionName] = elementClassOrId; // Element-Selektor speichern
            }
        });
    }

    // SVG-Styling anpassen
    const svgEl = xmlDoc.querySelector('svg');
    if (svgEl) {
      if (!svgEl.getAttribute('viewBox')) svgEl.setAttribute('viewBox', '0 0 1024 423');
      svgEl.removeAttribute('width');
      svgEl.removeAttribute('height');
      svgEl.setAttribute('width', '100%');
      svgEl.setAttribute('height', '100%');
      svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      svgEl.style.width = '100%';
      svgEl.style.height = '100%';
    } else {
       console.error("Kein SVG-Element im geparsten Dokument gefunden.");
       setErrorLoading("Ungültiges SVG-Format.");
       if (containerRef.current) containerRef.current.innerHTML = '';
       return;
    }

    // SVG in den Container einfügen
    if(containerRef.current) {
       containerRef.current.innerHTML = ''; // Vorherigen Inhalt sicher löschen
       containerRef.current.appendChild(svgEl); // Füge das modifizierte SVG ein
    }

    // Event Listeners hinzufügen
    const currentActionMap = actionMap; // Kopie für den Cleanup
    Object.entries(currentActionMap).forEach(([actionName, elementSelector]) => {
       if (containerRef.current) {
            const elements = containerRef.current.querySelectorAll(`.${elementSelector}, [id="${elementSelector}"]`);
            elements.forEach(el => {
               const clickHandler = () => handleActionClick(actionName);
               el.style.cursor = 'pointer'; // Zeige, dass es klickbar ist
               el.addEventListener('click', clickHandler);
               // Speichere den Handler, um ihn später entfernen zu können
               if (!el.__eventListeners) el.__eventListeners = {};
               el.__eventListeners[actionName] = clickHandler;
            });
       }
    });
    setActions(currentActionMap); // Aktuelles Mapping speichern

    // Cleanup-Funktion
    return () => {
      console.log(`[Page] Cleanup für ${currentSvgFile}`);
      if (containerRef.current) {
          Object.entries(currentActionMap).forEach(([actionName, elementSelector]) => {
             const elements = containerRef.current.querySelectorAll(`.${elementSelector}, [id="${elementSelector}"]`);
             elements.forEach(el => {
                if (el.__eventListeners && el.__eventListeners[actionName]) {
                    el.removeEventListener('click', el.__eventListeners[actionName]);
                    delete el.__eventListeners[actionName]; // Referenz entfernen
                    el.style.cursor = ''; // Cursor zurücksetzen
                }
             });
          });
      }
    };

  }, [svgContent, properties, t, isLoading, errorLoading]); // Abhängigkeiten aktualisiert

  // Funktion zum Behandeln von Klicks auf Aktionen
  const handleActionClick = (actionName) => {
    // Stelle sicher, dass 'properties' und 'properties.actions' existieren
    if (!properties || !properties.actions) {
        console.warn(`Aktion '${actionName}' geklickt, aber 'properties.actions' ist nicht definiert.`);
        return;
    }
    const qhmiVariableNames = properties.actions[actionName];
    console.log(`[Page] Aktion geklickt: ${actionName}, Zugehörige Variablen:`, qhmiVariableNames);

    if (!qhmiVariableNames || !Array.isArray(qhmiVariableNames) || qhmiVariableNames.length === 0) {
      console.warn(`Keine QHMI-Variablen für Aktion '${actionName}' im Menü-Eintrag definiert.`);
      return;
    }

    // Fordere die *aktuellen* Settings vom Backend an
    socket.emit('request-settings', {}); // Ohne User, Backend soll alle senden
    socket.once('settings-update', (allSettingsData) => {
      if (!Array.isArray(allSettingsData)) {
           console.error("Ungültige Daten von 'settings-update' empfangen.");
           return;
      }
      // Filtere die benötigten Records basierend auf den Namen
      const recordsToShow = allSettingsData.filter(row => row && qhmiVariableNames.includes(row.NAME));

      if (recordsToShow.length > 0) {
        console.log(`[Page] Zeige EditModal für Variablen:`, recordsToShow.map(r => r.NAME));
        setEditRecords(recordsToShow); // Array übergeben
        setEditModalVisible(true);
      } else {
        console.warn(`Keine passenden QHMI_VARIABLES-Zeilen für Aktion '${actionName}' (${qhmiVariableNames.join(', ')}) in den empfangenen Settings gefunden.`);
        // Optional: Benutzerfeedback geben, dass keine Variablen konfiguriert sind
      }
    });
  };

  // Erfolgreiches Update im Modal
  const handleUpdateSuccess = () => {
    setEditModalVisible(false);
    setEditRecords([]); // Records zurücksetzen
    // Optional: Daten neu anfordern oder auf Broadcast warten
  };

  // --- Rendering ---
  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: '#888' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (errorLoading) {
    return (
      <div style={{ padding: '20px', color: '#ff4d4f', textAlign: 'center', height: '100%' }}>
        <h2>Fehler beim Laden der Seite</h2>
        <p>{errorLoading}</p>
      </div>
    );
  }

  if (!svgContent) {
      return <div style={{ padding: '20px', color: '#888', textAlign: 'center', height: '100%' }}>Kein Inhalt zum Anzeigen.</div>;
  }

  // Container für das SVG
  return (
    <>
      <div
        style={{ width: '100%', height: '100%', overflow: 'hidden', backgroundColor: '#000' }}
        ref={containerRef}
        // Der Inhalt wird durch den useEffect-Hook gesetzt
      />
      {/* Edit Modal bleibt unverändert, erwartet jetzt 'records' als Array */}
      {editModalVisible && editRecords.length > 0 && (
        <EditVariableModal
          visible={editModalVisible}
          records={editRecords} // Übergabe als Array
          onCancel={() => { setEditModalVisible(false); setEditRecords([]); }}
          onUpdateSuccess={handleUpdateSuccess}
        />
      )}
    </>
  );
};

export default Page;