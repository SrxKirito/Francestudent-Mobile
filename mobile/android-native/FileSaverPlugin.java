package org.francestudent.chat;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;

@CapacitorPlugin(name = "FileSaver")
public class FileSaverPlugin extends Plugin {
    @PluginMethod public void save(PluginCall call) {
        String data = call.getString("data");
        if (data == null) { call.reject("Contenu du fichier manquant."); return; }
        String name = call.getString("name", "fichier.txt").replaceAll("[\\\\/\\p{Cntrl}]", "_");
        if (name.isEmpty() || name.equals(".") || name.equals("..")) name = "fichier.txt";
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(call.getString("mime", "application/octet-stream"));
        intent.putExtra(Intent.EXTRA_TITLE, name);
        startActivityForResult(call, intent, "finishSave");
    }

    @ActivityCallback private void finishSave(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent intent = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || intent == null || intent.getData() == null) {
            call.reject("Enregistrement annulé."); return;
        }
        Uri uri = intent.getData();
        try (OutputStream output = getContext().getContentResolver().openOutputStream(uri, "w")) {
            if (output == null) throw new java.io.IOException("Destination indisponible");
            output.write(Base64.decode(call.getString("data", ""), Base64.DEFAULT));
            output.flush();
            JSObject value = new JSObject(); value.put("path", uri.toString()); call.resolve(value);
        } catch (Exception error) {
            call.reject("Impossible d’enregistrer le fichier : " + error.getMessage());
        }
    }
}
