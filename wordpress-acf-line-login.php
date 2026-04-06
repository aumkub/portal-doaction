<?php
/**
 * Add LINE Login Button Label settings via ACF
 * Add this to your theme's functions.php or a custom plugin
 */

// Register ACF options page for LINE Login settings
add_action('acf/init', function() {

    if( function_exists('acf_add_options_page') ) {

        acf_add_options_sub_page(array(
            'page_title'  => 'LINE Login Settings',
            'menu_title'  => 'LINE Login',
            'parent_slug' => 'options-general.php',
            'capability'  => 'manage_options'
        ));
    }
});

// Register ACF fields for LINE Login button labels
add_action('acf/init', function() {

    acf_add_local_field_group(array(
        'key' => 'group_line_login_button_labels',
        'title' => 'LINE Login Button Labels',
        'fields' => array(
            array(
                'key' => 'field_line_sign_in_label',
                'label' => 'Sign In Button Label',
                'name' => 'line_sign_in_label',
                'type' => 'text',
                'instructions' => 'Button text for LINE login sign-in button',
                'required' => 0,
                'default_value' => 'เข้าสู่ระบบด้วย LINE',
                'placeholder' => 'เข้าสู่ระบบด้วย LINE',
                'maxlength' => 100,
            ),
            array(
                'key' => 'field_line_sign_up_label',
                'label' => 'Sign Up Button Label',
                'name' => 'line_sign_up_label',
                'type' => 'text',
                'instructions' => 'Button text for LINE login sign-up button',
                'required' => 0,
                'default_value' => 'สมัครสมาชิกด้วย LINE',
                'placeholder' => 'สมัครสมาชิกด้วย LINE',
                'maxlength' => 100,
            ),
            array(
                'key' => 'field_line_connect_label',
                'label' => 'Connect Button Label',
                'name' => 'line_connect_label',
                'type' => 'text',
                'instructions' => 'Button text for LINE connect button',
                'required' => 0,
                'default_value' => 'เชื่อมต่อด้วย LINE',
                'placeholder' => 'เชื่อมต่อด้วย LINE',
                'maxlength' => 100,
            ),
        ),
        'location' => array(
            array(
                array(
                    'param' => 'options_page',
                    'operator' => '==',
                    'value' => 'acf-options-line-login-settings',
                ),
            ),
        ),
        'menu_order' => 0,
        'position' => 'normal',
        'style' => 'default',
        'label_placement' => 'top',
        'instruction_placement' => 'label',
        'hide_on_screen' => array(),
    ));
});

// Helper function to get LINE login button labels
function get_line_login_button_labels() {
    return array(
        'sign_in' => get_field('line_sign_in_label', 'option') ?: 'เข้าสู่ระบบด้วย LINE',
        'sign_up' => get_field('line_sign_up_label', 'option') ?: 'สมัครสมาชิกด้วย LINE',
        'connect' => get_field('line_connect_label', 'option') ?: 'เชื่อมต่อด้วย LINE',
    );
}
