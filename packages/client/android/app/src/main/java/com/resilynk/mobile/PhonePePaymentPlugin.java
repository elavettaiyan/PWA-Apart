package com.resilynk.mobile;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;

import androidx.activity.ComponentActivity;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.phonepe.intent.sdk.api.PhonePeKt;
import com.phonepe.intent.sdk.api.models.PhonePeEnvironment;

@CapacitorPlugin(name = "PhonePePayment")
public class PhonePePaymentPlugin extends Plugin {
    private ActivityResultLauncher<Intent> checkoutLauncher;

    @Override
    public void load() {
        if (getActivity() instanceof ComponentActivity) {
            checkoutLauncher = ((ComponentActivity) getActivity()).registerForActivityResult(
                new ActivityResultContracts.StartActivityForResult(),
                activityResult -> {
                    PluginCall savedCall = getSavedCall();
                    if (savedCall == null) {
                        return;
                    }

                    JSObject result = new JSObject();
                    result.put("resultCode", activityResult.getResultCode());
                    result.put("ok", activityResult.getResultCode() == Activity.RESULT_OK);

                    Intent data = activityResult.getData();
                    if (data != null && data.getExtras() != null) {
                        JSObject extras = new JSObject();
                        Bundle bundle = data.getExtras();
                        for (String key : bundle.keySet()) {
                            Object value = bundle.get(key);
                            extras.put(key, value != null ? String.valueOf(value) : null);
                        }
                        result.put("extras", extras);
                    }

                    savedCall.resolve(result);
                }
            );
        }
    }

    @PluginMethod
    public void init(PluginCall call) {
        String merchantId = call.getString("merchantId");
        String flowId = call.getString("flowId");
        String environment = call.getString("environment", "SANDBOX");
        Boolean enableLogging = call.getBoolean("enableLogging", false);
        String appId = call.getString("appId");

        if (merchantId == null || merchantId.isEmpty()) {
            call.reject("merchantId is required");
            return;
        }
        if (flowId == null || flowId.isEmpty()) {
            call.reject("flowId is required");
            return;
        }

        PhonePeEnvironment phonePeEnvironment = "RELEASE".equalsIgnoreCase(environment)
            ? PhonePeEnvironment.RELEASE
            : PhonePeEnvironment.SANDBOX;

        boolean initialized = PhonePeKt.init(
            getActivity(),
            merchantId,
            flowId,
            phonePeEnvironment,
            enableLogging,
            appId
        );

        if (!initialized) {
            call.reject("PhonePe SDK initialization failed");
            return;
        }

        JSObject result = new JSObject();
        result.put("success", true);
        call.resolve(result);
    }

    @PluginMethod
    public void startCheckout(PluginCall call) {
        String token = call.getString("token");
        String orderId = call.getString("orderId");

        if (token == null || token.isEmpty()) {
            call.reject("token is required");
            return;
        }
        if (orderId == null || orderId.isEmpty()) {
            call.reject("orderId is required");
            return;
        }
        if (checkoutLauncher == null) {
            call.reject("PhonePe activity launcher is not available");
            return;
        }

        saveCall(call);

        try {
            PhonePeKt.startCheckoutPage(getActivity(), token, orderId, checkoutLauncher);
        } catch (Exception exception) {
            call.reject(exception.getMessage() != null ? exception.getMessage() : "Unable to start PhonePe checkout", exception);
        }
    }
}